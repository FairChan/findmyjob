#!/usr/bin/env bash
# db:check — schema-integrity and static-analysis checks
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT"

# ---- 1. prisma validate -----------------------------------------------
echo "[1/7] prisma validate"
pnpm prisma validate

# ---- 2. schema drift (requires SHADOW_DATABASE_URL) -------------------
echo "[2/7] schema drift check"
if [ -n "${SHADOW_DATABASE_URL:-}" ]; then
  pnpm prisma migrate diff \
    --from-migrations prisma/migrations \
    --to-schema-datamodel prisma/schema.prisma \
    --shadow-database-url "$SHADOW_DATABASE_URL" \
    --exit-code
else
  if [ "${APP_ENV:-development}" = "ci" ]; then
    echo "ERROR: SHADOW_DATABASE_URL not set in CI" >&2; exit 1
  fi
  echo "WARN: SHADOW_DATABASE_URL not set — skipping drift check"
fi

# ---- 3. DateTime ↔ Timestamptz(3) count must match --------------------
echo "[3/7] DateTime ↔ Timestamptz(3) parity"
DT_COUNT=$(grep -c 'DateTime' prisma/schema.prisma || true)
TZ_COUNT=$(grep -c '@db\.Timestamptz(3)' prisma/schema.prisma || true)
if [ "$DT_COUNT" -ne "$TZ_COUNT" ]; then
  echo "ERROR: DateTime count ($DT_COUNT) ≠ @db.Timestamptz(3) count ($TZ_COUNT)" >&2
  exit 1
fi

# ---- 4. CONCURRENTLY migrations must be single-statement files --------
echo "[4/7] CONCURRENTLY migrations"
shopt -s nullglob
for f in prisma/migrations/*/migration.sql; do
  if grep -qE '\bCONCURRENTLY\b' "$f" 2>/dev/null; then
    stmt_count=$(grep -c ';' "$f" || echo 0)
    if [ "$stmt_count" -ne 1 ]; then
      echo "ERROR: $f contains CONCURRENTLY but has $stmt_count semicolons (must be exactly 1 statement)" >&2
      exit 1
    fi
  fi
done

# ---- 5. Destructive SQL must carry a contract-approved comment --------
echo "[5/7] contract-approved comments on destructive SQL"
DESTRUCTIVE_RE='\b(DROP COLUMN|DROP TABLE|RENAME COLUMN|RENAME TABLE)\b|ALTER COLUMN .+\b(TYPE|SET NOT NULL)\b'
for f in prisma/migrations/*/migration.sql; do
  if grep -qiE "$DESTRUCTIVE_RE" "$f" 2>/dev/null; then
    if ! grep -qF '-- contract-approved:' "$f"; then
      echo "ERROR: $f contains destructive SQL without '-- contract-approved:' comment" >&2
      exit 1
    fi
  fi
done

# ---- 6. No session-level advisory locks or *Unsafe raw SQL in src/ ---
echo "[6/7] unsafe patterns in src/"
# pg_advisory_lock (session-level); pg_advisory_xact_lock (transaction-level, OK) won't match
if grep -rqE '\bpg_advisory_lock\(' src/ 2>/dev/null; then
  echo "ERROR: found session-level pg_advisory_lock in src/ — use pg_advisory_xact_lock instead" >&2
  exit 1
fi
if grep -rqE '\$(queryRawUnsafe|executeRawUnsafe)\b' src/ 2>/dev/null; then
  echo "ERROR: found *Unsafe raw SQL in src/ — use \$queryRaw/\$executeRaw template strings" >&2
  exit 1
fi

# ---- 7. FK columns must have a leading index (requires a live DB) -----
echo "[7/7] FK index check"
FK_CHECK_URL="${TEST_ADMIN_DATABASE_URL:-${SHADOW_DATABASE_URL:-}}"
if [ -n "$FK_CHECK_URL" ] && command -v psql >/dev/null 2>&1; then
  MISSING=$(psql "$FK_CHECK_URL" -t -A -c "
SELECT c.conrelid::regclass::text || '.' || a.attname
FROM pg_constraint c
JOIN pg_attribute a
  ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
WHERE c.contype = 'f'
  AND c.conrelid::regclass::text NOT LIKE 'pg_%'
  AND c.conrelid::regclass::text NOT LIKE 'information_schema%'
  AND NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid = c.conrelid
      AND i.indkey[0] = a.attnum
  )
ORDER BY 1;" 2>/dev/null || true)
  if [ -n "$MISSING" ]; then
    echo "ERROR: FK columns missing a leading index:" >&2
    echo "$MISSING" >&2
    exit 1
  fi
else
  if [ -z "$FK_CHECK_URL" ]; then
    echo "WARN: no DB URL for FK index check — skipping"
  else
    echo "WARN: psql not found — skipping FK index check"
  fi
fi

echo ""
echo "==> db:check passed"
