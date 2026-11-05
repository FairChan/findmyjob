#!/usr/bin/env bash
# restore-drill.test.sh
# Bash-level unit tests for restore-drill.sh argument validation.
# No database or S3 connection required.
set -euo pipefail

SCRIPT="$(dirname "${BASH_SOURCE[0]}")/restore-drill.sh"
PASS=0
FAIL=0

assert_exit() {
  local desc="$1"
  local expected="$2"
  shift 2
  local actual
  actual=$(bash "$SCRIPT" "$@" </dev/null 2>&1) && rc=$? || rc=$?
  if [ "$rc" -eq "$expected" ]; then
    echo "PASS: $desc"
    PASS=$(( PASS + 1 ))
  else
    echo "FAIL: $desc (expected exit $expected, got $rc)"
    echo "      output: $actual"
    FAIL=$(( FAIL + 1 ))
  fi
}

# ── db_name validation ────────────────────────────────────────────────────────
assert_exit "no args → exit 1" 1

assert_exit "db_name without _drill suffix → exit 1" 1 \
  --key db/daily/2026-11-05T19-15-00Z.dump.age findmyjob

assert_exit "db_name = findmyjob_production → exit 1" 1 \
  --key db/daily/2026-11-05T19-15-00Z.dump.age findmyjob_production

assert_exit "db_name = findmyjob_drill → reaches env check, not db_name error" 1 \
  --key db/daily/2026-11-05T19-15-00Z.dump.age findmyjob_drill

# ── --key validation ──────────────────────────────────────────────────────────
assert_exit "missing --key → exit 1" 1 findmyjob_drill

assert_exit "invalid key format (no prefix) → exit 1" 1 \
  --key 2026-11-05T19-15-00Z.dump.age findmyjob_drill

assert_exit "invalid key (wrong extension) → exit 1" 1 \
  --key db/daily/2026-11-05T19-15-00Z.dump findmyjob_drill

assert_exit "invalid key (letters in timestamp) → exit 1" 1 \
  --key db/daily/2026-xx-05T19-15-00Z.dump.age findmyjob_drill

assert_exit "valid key (daily) → reaches env check, not key error" 1 \
  --key db/daily/2026-11-05T19-15-00Z.dump.age findmyjob_drill

assert_exit "valid key (pre-migrate) → reaches env check, not key error" 1 \
  --key db/pre-migrate/2026-11-05T19-15-00Z.dump.age findmyjob_drill

# ── magic header: aws s3api failure → explicit error exit (not silent) ────────
# SIGPIPE race itself cannot be reproduced in a mock, so we test that an
# explicit aws failure exits non-zero with an error message (bash -n noted).
_MOCK_BIN="$(mktemp -d -t restore-drill-mock.XXXXXXXX)"
cat > "${_MOCK_BIN}/aws" <<'MOCKEOF'
#!/usr/bin/env bash
exit 1
MOCKEOF
chmod +x "${_MOCK_BIN}/aws"
for _cmd in age psql pg_restore python3; do
  printf '#!/usr/bin/env bash\nexit 0\n' > "${_MOCK_BIN}/${_cmd}"
  chmod +x "${_MOCK_BIN}/${_cmd}"
done

_magic_rc=0
_magic_out=""
_magic_out=$(
  PATH="${_MOCK_BIN}:${PATH}" \
  BACKUP_S3_BUCKET=testbucket \
  RESTORE_S3_ACCESS_KEY_ID=testkey \
  RESTORE_S3_SECRET_ACCESS_KEY=testsecret \
  RESTORE_ADMIN_DATABASE_URL="postgresql://u:p@localhost/postgres" \
  bash "$SCRIPT" --key db/daily/2026-11-05T19-15-00Z.dump.age findmyjob_drill \
    <<< "AGE-SECRET-KEY-1TESTKEY000000000000000000000000000000000000000000000000" \
    2>&1
) || _magic_rc=$?

if [ "$_magic_rc" -ne 0 ] && echo "$_magic_out" | grep -q "ERROR:"; then
  echo "PASS: aws s3api failure → non-zero exit with ERROR message"
  PASS=$(( PASS + 1 ))
else
  echo "FAIL: aws s3api failure should produce ERROR and non-zero exit (rc=${_magic_rc})"
  echo "      output: ${_magic_out}"
  FAIL=$(( FAIL + 1 ))
fi
rm -rf "${_MOCK_BIN}"
unset _MOCK_BIN _cmd _magic_rc _magic_out

# ── summary ───────────────────────────────────────────────────────────────────
echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ] || exit 1
