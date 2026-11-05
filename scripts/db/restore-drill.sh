#!/usr/bin/env bash
# restore-drill.sh <db_name>
# Disaster-recovery drill: download the latest backup from S3, decrypt it,
# restore into a temporary drill database, run verification checks, print RTO.
#
# Usage:
#   cat age-private.key | ssh admin@host \
#     "cd /opt/findmyjob && bash scripts/db/restore-drill.sh findmyjob_drill"
#
# Required env vars:
#   RESTORE_ADMIN_DATABASE_URL   — owner-level URL ending in /postgres
#                                  e.g. postgresql://findmyjob_owner:pass@127.0.0.1:5432/postgres
#   BACKUP_S3_BUCKET             — backup bucket name
#   RESTORE_S3_ACCESS_KEY_ID     — restore-reader credentials (kept offline; inject for drill)
#   RESTORE_S3_SECRET_ACCESS_KEY — restore-reader credentials
#
# Optional env vars:
#   BACKUP_S3_REGION             — default: ap-southeast-5
#   BACKUP_S3_ENDPOINT           — S3-compatible endpoint (MinIO etc.)
#   PII_KEYS                     — PII encryption keys for verify-decrypt step
#   APP_TAG                      — Docker image tag for the tools container
set -euo pipefail

DB_NAME="${1:?Usage: restore-drill.sh <db_name>}"

# Safety: refuse any database name that does not end with _drill
if [[ "$DB_NAME" != *_drill ]]; then
  echo "ERROR: database name must end with _drill (refusing to restore into: ${DB_NAME})" >&2
  exit 1
fi

# Required env
: "${RESTORE_ADMIN_DATABASE_URL:?RESTORE_ADMIN_DATABASE_URL is required}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is required}"
: "${RESTORE_S3_ACCESS_KEY_ID:?RESTORE_S3_ACCESS_KEY_ID is required}"
[ -n "${RESTORE_S3_SECRET_ACCESS_KEY:-}" ] || { echo "RESTORE_S3_SECRET_ACCESS_KEY is required" >&2; exit 1; }

BACKUP_S3_REGION="${BACKUP_S3_REGION:-ap-southeast-5}"
S3_ARGS=(--no-progress --region "$BACKUP_S3_REGION")
if [ -n "${BACKUP_S3_ENDPOINT:-}" ]; then
  S3_ARGS+=(--endpoint-url "$BACKUP_S3_ENDPOINT")
fi

export AWS_ACCESS_KEY_ID="$RESTORE_S3_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$RESTORE_S3_SECRET_ACCESS_KEY"

# Check required tools
for cmd in age aws psql pg_restore python3; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: required tool not found: $cmd" >&2
    echo "  Install: age (apt install age), awscli (apt install awscli)," >&2
    echo "           postgresql-client-16 (see PostgreSQL APT repo), python3" >&2
    exit 1
  fi
done

# ── temp files & cleanup ──────────────────────────────────────────────────────
TMPDIR_LOCAL=$(mktemp -d -t restore-drill.XXXXXXXX)
TMPKEY="${TMPDIR_LOCAL}/age.key"
ENCRYPTED_DUMP="${TMPDIR_LOCAL}/backup.dump.age"
DECRYPTED_DUMP="${TMPDIR_LOCAL}/backup.dump"
COUNTS_LOCAL="${TMPDIR_LOCAL}/counts.json"

cleanup() {
  # Securely remove plaintext dump and private key
  rm -rf "$TMPDIR_LOCAL"
}
trap cleanup EXIT

# Read age private key from stdin (piped in by operator)
cat > "$TMPKEY"
if [ ! -s "$TMPKEY" ]; then
  echo "ERROR: no age private key received on stdin" >&2
  exit 1
fi

DRILL_START=$(date +%s)
echo "[drill] $(date -u +%Y-%m-%dT%H:%M:%SZ) starting restore drill into ${DB_NAME}"

# ── 1. find the latest daily backup ──────────────────────────────────────────
LATEST_KEY=$(aws s3 ls "${S3_ARGS[@]}" "s3://${BACKUP_S3_BUCKET}/db/daily/" \
  | sort | tail -n1 | awk '{print $4}')

if [ -z "$LATEST_KEY" ]; then
  echo "ERROR: no backup found in s3://${BACKUP_S3_BUCKET}/db/daily/" >&2
  exit 1
fi
echo "[drill] latest backup: db/daily/${LATEST_KEY}"

# ── 2. download encrypted dump and counts.json ───────────────────────────────
aws s3 cp "${S3_ARGS[@]}" \
  "s3://${BACKUP_S3_BUCKET}/db/daily/${LATEST_KEY}" "$ENCRYPTED_DUMP"

aws s3 cp "${S3_ARGS[@]}" \
  "s3://${BACKUP_S3_BUCKET}/db/counts.json" "$COUNTS_LOCAL"

echo "[drill] download complete"

# ── 3. decrypt the backup ─────────────────────────────────────────────────────
age -d -i "$TMPKEY" "$ENCRYPTED_DUMP" > "$DECRYPTED_DUMP"
# Wipe the age key from disk immediately after use
shred -u "$TMPKEY" 2>/dev/null || rm -f "$TMPKEY"
echo "[drill] decryption complete"

# ── 4. create drill database ──────────────────────────────────────────────────
# Strip last path component from RESTORE_ADMIN_DATABASE_URL to get base URL
ADMIN_BASE="${RESTORE_ADMIN_DATABASE_URL%/*}"
DRILL_DATABASE_URL="${ADMIN_BASE}/${DB_NAME}"

psql "$RESTORE_ADMIN_DATABASE_URL" -c "DROP DATABASE IF EXISTS \"${DB_NAME}\";"
psql "$RESTORE_ADMIN_DATABASE_URL" -c "CREATE DATABASE \"${DB_NAME}\" OWNER findmyjob_owner;"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
psql "$DRILL_DATABASE_URL" -f "${REPO_ROOT}/docker/postgres/db-setup.sql"

echo "[drill] drill database created"

# ── 5. restore ───────────────────────────────────────────────────────────────
pg_restore -d "$DRILL_DATABASE_URL" \
  --no-acl \
  --role=findmyjob_owner \
  --single-transaction \
  "$DECRYPTED_DUMP"

# Remove plaintext dump immediately after restore
shred -u "$DECRYPTED_DUMP" 2>/dev/null || rm -f "$DECRYPTED_DUMP"
echo "[drill] pg_restore complete"

# ── 6. check: migration count ─────────────────────────────────────────────────
MIGRATIONS_IN_DB=$(psql "$DRILL_DATABASE_URL" -t -A -c \
  "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;")
MIGRATIONS_ON_DISK=$(ls "${REPO_ROOT}/prisma/migrations"/*/migration.sql 2>/dev/null | wc -l)

if [ "$MIGRATIONS_IN_DB" -ne "$MIGRATIONS_ON_DISK" ]; then
  echo "FAIL: migration count mismatch (DB: ${MIGRATIONS_IN_DB}, disk: ${MIGRATIONS_ON_DISK})" >&2
  exit 1
fi
echo "[check] migrations: ${MIGRATIONS_IN_DB} ✓"

# ── 7. check: key tables not empty ───────────────────────────────────────────
for TABLE in User StudentProfile Company Job Application; do
  COUNT=$(psql "$DRILL_DATABASE_URL" -t -A -c "SELECT count(*) FROM \"${TABLE}\";")
  echo "[check] ${TABLE}: ${COUNT} rows"
done

# ── 8. check: RPO <= 26 hours ────────────────────────────────────────────────
BACKUP_TIMESTAMP=$(python3 -c "import json,sys; print(json.load(open('${COUNTS_LOCAL}'))['timestamp'])")
BACKUP_EPOCH=$(date -d "$BACKUP_TIMESTAMP" +%s 2>/dev/null \
  || python3 -c "from datetime import datetime; print(int(datetime.fromisoformat('${BACKUP_TIMESTAMP}'.replace('Z','+00:00')).timestamp()))")
NOW_EPOCH=$(date +%s)
AGE_HOURS=$(( (NOW_EPOCH - BACKUP_EPOCH) / 3600 ))

if [ "$AGE_HOURS" -gt 26 ]; then
  echo "FAIL: RPO exceeded — backup is ${AGE_HOURS}h old (limit: 26h)" >&2
  exit 1
fi
echo "[check] RPO: ${AGE_HOURS}h ✓"

# ── 9. check: reconciliation SQL returns 0 rows ───────────────────────────────
RECON=$(psql "$DRILL_DATABASE_URL" -t -A -c "
  SELECT w.\"id\"
  FROM \"CreditWallet\" w
  WHERE w.\"balance\" != (
    SELECT COALESCE(SUM(l.\"delta\"), 0)
    FROM \"CreditLedger\" l
    WHERE l.\"walletId\" = w.\"id\"
  );
")
if [ -n "$RECON" ]; then
  echo "FAIL: credit wallet balance mismatch for wallet(s): ${RECON}" >&2
  exit 1
fi
echo "[check] reconciliation: 0 discrepancies ✓"

# ── 10. check: counts.json match ─────────────────────────────────────────────
python3 - "${DRILL_DATABASE_URL}" "${COUNTS_LOCAL}" <<'PYEOF'
import sys, json, subprocess

db_url = sys.argv[1]
counts_file = sys.argv[2]
expected = json.load(open(counts_file))
tables = ["User", "StudentProfile", "Company", "Job", "Application", "CreditLedger", "AuditLog"]
failures = []

for table in tables:
    if table not in expected:
        continue
    result = subprocess.run(
        ["psql", db_url, "-t", "-A", "-c", f'SELECT count(*)::int FROM "{table}";'],
        capture_output=True, text=True
    )
    actual = int(result.stdout.strip())
    exp = expected[table]
    if actual != exp:
        failures.append(f"{table}: expected {exp}, got {actual}")

if failures:
    print("FAIL: counts.json mismatch:", ", ".join(failures), file=sys.stderr)
    sys.exit(1)
print(f"[check] counts.json: all {len(tables)} tables match ✓")
PYEOF

# ── 11. check: verify-decrypt ────────────────────────────────────────────────
if [ -n "${PII_KEYS:-}" ] && [ -n "${APP_TAG:-}" ]; then
  docker compose -f "${REPO_ROOT}/deploy/docker-compose.prod.yml" \
    --profile ops run --rm \
    --no-deps \
    -e "DATABASE_URL=${DRILL_DATABASE_URL}" \
    -e "PII_KEYS=${PII_KEYS}" \
    -e "PII_ACTIVE_KEY_ID=${PII_ACTIVE_KEY_ID:-v1}" \
    tools \
    scripts/db/verify-decrypt.ts
  echo "[check] verify-decrypt ✓"
else
  echo "[check] verify-decrypt SKIPPED (set PII_KEYS and APP_TAG to enable)"
fi

# ── 12. clear sessions ────────────────────────────────────────────────────────
psql "$DRILL_DATABASE_URL" -c 'DELETE FROM "Session";'
echo "[check] sessions cleared"

# ── RTO ───────────────────────────────────────────────────────────────────────
DRILL_END=$(date +%s)
RTO_SECONDS=$(( DRILL_END - DRILL_START ))
echo ""
echo "[drill] ======================================="
echo "[drill] RESTORE DRILL COMPLETE"
echo "[drill] RTO: ${RTO_SECONDS}s ($(( RTO_SECONDS / 60 ))m $(( RTO_SECONDS % 60 ))s)"
echo "[drill] Backup age: ${AGE_HOURS}h (RPO ok)"
echo "[drill] Drill database: ${DB_NAME} (drop when done)"
echo "[drill] ======================================="
