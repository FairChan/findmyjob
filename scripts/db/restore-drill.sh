#!/usr/bin/env bash
# restore-drill.sh --key <object-key> [--version-id <vid>] [--skip-rpo] [--keep] <db_name>
# Disaster-recovery drill: download a specific backup from S3, decrypt it
# (never writing plaintext to disk), restore into a drill database, run checks.
#
# Usage:
#   cat age-private.key | bash scripts/db/restore-drill.sh \
#     --key db/daily/2026-11-05T19-15-00Z.dump.age findmyjob_restore_drill
#
# Required env vars:
#   RESTORE_ADMIN_DATABASE_URL   — owner-level URL ending in /postgres
#                                  e.g. postgresql://findmyjob_owner:pass@postgres:5432/postgres
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

# ── argument parsing ──────────────────────────────────────────────────────────
OBJECT_KEY=""
VERSION_ID=""
SKIP_RPO=0
KEEP_DRILL_DB=0
DB_NAME=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --key)       OBJECT_KEY="$2"; shift 2 ;;
    --version-id) VERSION_ID="$2"; shift 2 ;;
    --skip-rpo)  SKIP_RPO=1; shift ;;
    --keep)      KEEP_DRILL_DB=1; shift ;;
    -*)          echo "ERROR: unknown option: $1" >&2; exit 1 ;;
    *)           DB_NAME="$1"; shift ;;
  esac
done

if [ -z "$DB_NAME" ]; then
  echo "ERROR: Usage: restore-drill.sh --key <object-key> [--version-id <vid>] [--skip-rpo] [--keep] <db_name>" >&2
  exit 1
fi
if [ -z "$OBJECT_KEY" ]; then
  echo "ERROR: --key <object-key> is required (e.g. db/daily/2026-11-05T19-15-00Z.dump.age)" >&2
  exit 1
fi

# Safety: refuse any database name that does not end with _drill
if [[ "$DB_NAME" != *_drill ]]; then
  echo "ERROR: database name must end with _drill (refusing to restore into: ${DB_NAME})" >&2
  exit 1
fi

# Validate key format: db/(daily|pre-migrate)/YYYY-MM-DDTHH-MM-SSZ.dump.age
if ! [[ "$OBJECT_KEY" =~ ^db/(daily|pre-migrate)/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}Z\.dump\.age$ ]]; then
  echo "ERROR: --key must match db/(daily|pre-migrate)/YYYY-MM-DDTHH-MM-SSZ.dump.age" >&2
  exit 1
fi

# Derive counts.json key (same prefix, different extension)
COUNTS_KEY="${OBJECT_KEY%.dump.age}.counts.json"

# Extract ISO 8601 timestamp from key name (hyphens in time → colons)
_key_base="$(basename "$OBJECT_KEY" .dump.age)"
BACKUP_TIMESTAMP_ISO="${_key_base/T/-}"; BACKUP_TIMESTAMP_ISO="${_key_base}"
# Key basename is e.g. 2026-11-05T19-15-00Z; convert HH-MM-SS → HH:MM:SS
BACKUP_TIMESTAMP_ISO="$(echo "$_key_base" | sed 's/T\([0-9]\{2\}\)-\([0-9]\{2\}\)-\([0-9]\{2\}\)Z$/T\1:\2:\3Z/')"
# Validate the resulting timestamp format
if ! [[ "$BACKUP_TIMESTAMP_ISO" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]; then
  echo "ERROR: could not derive ISO timestamp from key name: ${_key_base}" >&2
  exit 1
fi
unset _key_base

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
if [ -n "$VERSION_ID" ]; then
  S3_ARGS+=(--version-id "$VERSION_ID")
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

# ── temp file for counts.json only; private key and dump never touch disk ─────
TMPDIR_LOCAL=$(mktemp -d -t restore-drill.XXXXXXXX)
COUNTS_LOCAL="${TMPDIR_LOCAL}/counts.json"

# age private key lives only in this variable; unset on exit
AGE_PRIVATE_KEY=""
DRILL_DB_CREATED=0

cleanup() {
  unset AGE_PRIVATE_KEY
  rm -rf "$TMPDIR_LOCAL"
  # Drop drill database unless --keep was passed and restore succeeded
  if [ "$DRILL_DB_CREATED" -eq 1 ] && [ "$KEEP_DRILL_DB" -eq 0 ]; then
    psql "$RESTORE_ADMIN_DATABASE_URL" -c "DROP DATABASE IF EXISTS \"${DB_NAME}\";" 2>/dev/null || true
    echo "[drill] drill database dropped"
  fi
}
trap cleanup EXIT

# Read age private key from stdin (piped in by operator); never write to disk
IFS= read -r -d '' AGE_PRIVATE_KEY || true
if [ -z "$AGE_PRIVATE_KEY" ]; then
  echo "ERROR: no age private key received on stdin" >&2
  exit 1
fi

DRILL_START=$(date +%s)
echo "[drill] $(date -u +%Y-%m-%dT%H:%M:%SZ) starting restore drill into ${DB_NAME}"
echo "[drill] backup key: s3://${BACKUP_S3_BUCKET}/${OBJECT_KEY}"

# ── 1. verify age magic header ────────────────────────────────────────────────
# Use s3api get-object --range instead of "s3 cp … | head -c 21" to avoid
# SIGPIPE: when head exits, aws s3 cp receives SIGPIPE (exit 141), making the
# pipeline fail under set -euo pipefail and causing a silent exit before the
# magic check runs. The 21-byte temp file contains only ciphertext — no plaintext.
MAGIC_TMP="${TMPDIR_LOCAL}/magic.bin"
S3API_RANGE_ARGS=(--region "$BACKUP_S3_REGION" --bucket "$BACKUP_S3_BUCKET" \
  --key "$OBJECT_KEY" --range "bytes=0-20")
if [ -n "${BACKUP_S3_ENDPOINT:-}" ]; then
  S3API_RANGE_ARGS+=(--endpoint-url "$BACKUP_S3_ENDPOINT")
fi
if [ -n "$VERSION_ID" ]; then
  S3API_RANGE_ARGS+=(--version-id "$VERSION_ID")
fi
if ! aws s3api get-object "${S3API_RANGE_ARGS[@]}" "$MAGIC_TMP" >/dev/null; then
  echo "ERROR: failed to fetch magic header from s3://${BACKUP_S3_BUCKET}/${OBJECT_KEY}" >&2
  exit 1
fi
MAGIC="$(tr -d '\n' < "$MAGIC_TMP")"
rm -f "$MAGIC_TMP"
if [ "$MAGIC" != "age-encryption.org/v1" ]; then
  echo "ERROR: S3 object does not look like an age-encrypted file (magic: '${MAGIC}')" >&2
  exit 1
fi
echo "[drill] age magic header verified"

# ── 2. create drill database ──────────────────────────────────────────────────
ADMIN_BASE="${RESTORE_ADMIN_DATABASE_URL%/*}"
DRILL_DATABASE_URL="${ADMIN_BASE}/${DB_NAME}"

psql "$RESTORE_ADMIN_DATABASE_URL" -c "DROP DATABASE IF EXISTS \"${DB_NAME}\";"
psql "$RESTORE_ADMIN_DATABASE_URL" -c "CREATE DATABASE \"${DB_NAME}\" OWNER findmyjob_owner;"
DRILL_DB_CREATED=1

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
psql "$DRILL_DATABASE_URL" -f "${REPO_ROOT}/docker/postgres/db-setup.sql"

echo "[drill] drill database created"

# ── 3. decrypt stream → pg_restore (no plaintext on disk) ────────────────────
# S3 object is streamed through age decryption directly into pg_restore.
# Private key is passed via process substitution (no temp file on disk).
aws s3 cp "${S3_ARGS[@]}" "s3://${BACKUP_S3_BUCKET}/${OBJECT_KEY}" - \
  | age -d -i <(printf '%s\n' "$AGE_PRIVATE_KEY") \
  | pg_restore -d "$DRILL_DATABASE_URL" \
      --no-acl \
      --role=findmyjob_owner \
      --single-transaction \
      -

# Private key no longer needed after restore
unset AGE_PRIVATE_KEY
echo "[drill] decrypt + pg_restore complete"

# ── 4. check: migration count ─────────────────────────────────────────────────
MIGRATIONS_IN_DB=$(psql "$DRILL_DATABASE_URL" -t -A -c \
  "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;")
MIGRATIONS_ON_DISK=$(ls "${REPO_ROOT}/prisma/migrations"/*/migration.sql 2>/dev/null | wc -l)

if [ "$MIGRATIONS_IN_DB" -ne "$MIGRATIONS_ON_DISK" ]; then
  echo "FAIL: migration count mismatch (DB: ${MIGRATIONS_IN_DB}, disk: ${MIGRATIONS_ON_DISK})" >&2
  exit 1
fi
echo "[check] migrations: ${MIGRATIONS_IN_DB} ✓"

# ── 5. check: key tables not empty ───────────────────────────────────────────
for TABLE in User StudentProfile Company Job Application; do
  COUNT=$(psql "$DRILL_DATABASE_URL" -t -A -c "SELECT count(*) FROM \"${TABLE}\";")
  echo "[check] ${TABLE}: ${COUNT} rows"
done

# ── 6. check: RPO <= 26 hours (from key name timestamp) ──────────────────────
# BACKUP_TIMESTAMP_ISO was derived from the key name and already regex-validated.
BACKUP_EPOCH=$(date -u -d "$BACKUP_TIMESTAMP_ISO" +%s 2>/dev/null \
  || python3 -c "import sys; from datetime import datetime, timezone; \
     print(int(datetime.fromisoformat(sys.argv[1].replace('Z','+00:00')).timestamp()))" \
     "$BACKUP_TIMESTAMP_ISO")
NOW_EPOCH=$(date +%s)
AGE_HOURS=$(( (NOW_EPOCH - BACKUP_EPOCH) / 3600 ))

if [ "$SKIP_RPO" -eq 0 ] && [ "$AGE_HOURS" -gt 26 ]; then
  echo "FAIL: RPO exceeded — backup is ${AGE_HOURS}h old (limit: 26h)" >&2
  exit 1
fi
if [ "$SKIP_RPO" -eq 1 ]; then
  echo "[check] RPO: ${AGE_HOURS}h (check skipped via --skip-rpo)"
else
  echo "[check] RPO: ${AGE_HOURS}h ✓"
fi

# ── 7. check: reconciliation SQL returns 0 rows ───────────────────────────────
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

# ── 8. check: per-dump counts.json match ─────────────────────────────────────
# Download per-dump counts.json (sibling of the dump object)
aws s3 cp "${S3_ARGS[@]}" "s3://${BACKUP_S3_BUCKET}/${COUNTS_KEY}" "$COUNTS_LOCAL"
echo "[drill] counts.json downloaded: s3://${BACKUP_S3_BUCKET}/${COUNTS_KEY}"

# Pass counts.json path via argv — never interpolate S3 content into code
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

# ── 9. check: verify-decrypt ─────────────────────────────────────────────────
if [ -n "${PII_KEYS:-}" ] && [ -n "${APP_TAG:-}" ]; then
  docker compose -f "${REPO_ROOT}/deploy/docker-compose.prod.yml" \
    --profile ops run --rm \
    --no-deps \
    -e "DATABASE_URL=${DRILL_DATABASE_URL}" \
    -e PII_KEYS \
    -e "PII_ACTIVE_KEY_ID=${PII_ACTIVE_KEY_ID:-v1}" \
    tools \
    scripts/db/verify-decrypt.ts
  echo "[check] verify-decrypt ✓"
else
  echo "[check] verify-decrypt SKIPPED (set PII_KEYS and APP_TAG to enable)"
fi

# ── 10. clear sessions ────────────────────────────────────────────────────────
psql "$DRILL_DATABASE_URL" -c 'DELETE FROM "Session";'
echo "[check] sessions cleared"

# ── RTO ───────────────────────────────────────────────────────────────────────
DRILL_END=$(date +%s)
RTO_SECONDS=$(( DRILL_END - DRILL_START ))

echo ""
echo "[drill] ======================================="
echo "[drill] RESTORE DRILL COMPLETE"
echo "[drill] RTO: ${RTO_SECONDS}s ($(( RTO_SECONDS / 60 ))m $(( RTO_SECONDS % 60 ))s)"
echo "[drill] Backup age: ${AGE_HOURS}h (RPO: $([ "$SKIP_RPO" -eq 0 ] && echo ok || echo skipped))"
echo "[drill] Backup key: ${OBJECT_KEY}"
if [ "$KEEP_DRILL_DB" -eq 1 ]; then
  echo "[drill] Drill database retained (--keep): ${DB_NAME}"
else
  echo "[drill] Drill database will be dropped on exit"
fi
echo "[drill] ======================================="
