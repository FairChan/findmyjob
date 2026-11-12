#!/usr/bin/env bash
# restore-drill.test.sh
# Bash-level unit tests for restore-drill.sh argument validation.
# No database or S3 connection required.
set -euo pipefail

SCRIPT="$(dirname "${BASH_SOURCE[0]}")/restore-drill.sh"
PASS=0
FAIL=0

# Exercise both real restore pipelines with synthetic bytes. PostgreSQL treats
# a positional '-' as a filename; stdin requires omitting the filename entirely.
_stdin_bin="$(mktemp -d -t restore-drill-stdin.XXXXXXXX)"
cat > "${_stdin_bin}/aws" <<'MOCKEOF'
#!/usr/bin/env bash
if [[ "$*" == *"--range"* ]]; then
  printf 'age-encryption.org/v1' > "${@: -1}"
elif [[ "$*" == *"s3api get-object"* ]]; then
  printf 'synthetic-archive' > "${@: -1}"
else
  printf 'synthetic-archive'
fi
MOCKEOF
cat > "${_stdin_bin}/age" <<'MOCKEOF'
#!/usr/bin/env bash
cat
MOCKEOF
cat > "${_stdin_bin}/pg_restore" <<'MOCKEOF'
#!/usr/bin/env bash
for arg in "$@"; do
  if [[ "$arg" == "-" ]]; then
    echo 'ERROR: pg_restore received filename instead of stdin' >&2
    exit 91
  fi
done
[[ "$(cat)" == 'synthetic-archive' ]] || exit 92
echo 'MOCK: pg_restore consumed stdin'
MOCKEOF
cat > "${_stdin_bin}/psql" <<'MOCKEOF'
#!/usr/bin/env bash
# Deliberately fail migration verification after restore, preserving its guard.
if [[ "$*" == *"SELECT count(*) FROM _prisma_migrations"* ]]; then echo 999999; fi
MOCKEOF
printf '#!/usr/bin/env bash\nexit 0\n' > "${_stdin_bin}/python3"
chmod +x "${_stdin_bin}"/*
for _stdin_branch in streaming versioned; do
  _stdin_args=()
  [[ "$_stdin_branch" == versioned ]] && _stdin_args+=(--version-id synthetic-version)
  _stdin_rc=0
  _stdin_out=$(
    PATH="${_stdin_bin}:${PATH}" BACKUP_S3_BUCKET=testbucket \
    RESTORE_S3_ACCESS_KEY_ID=testkey RESTORE_S3_SECRET_ACCESS_KEY=testsecret \
    RESTORE_ADMIN_DATABASE_URL=postgresql://u:p@localhost:5432/postgres \
    bash "$SCRIPT" --key db/daily/2026-11-05T19-15-00Z.dump.age \
      "${_stdin_args[@]}" --skip-rpo findmyjob_restore_drill <<< synthetic-private-key 2>&1
  ) || _stdin_rc=$?
  if [[ "$_stdin_rc" -eq 1 ]] \
    && [[ "$_stdin_out" == *'MOCK: pg_restore consumed stdin'* ]] \
    && [[ "$_stdin_out" == *'FAIL: migration count mismatch'* ]]; then
    echo "PASS: ${_stdin_branch} pg_restore consumes stdin without filename; migration guard retained"
    PASS=$(( PASS + 1 ))
  else
    echo "FAIL: ${_stdin_branch} pg_restore stdin (rc=${_stdin_rc}): ${_stdin_out}"
    FAIL=$(( FAIL + 1 ))
  fi
done
rm -rf "${_stdin_bin}"
unset _stdin_bin _stdin_branch _stdin_args _stdin_rc _stdin_out

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

# ── session-cleared-on-failure ────────────────────────────────────────────────
# After DRILL_DB_CREATED is set (psql CREATE DATABASE succeeds), any subsequent
# failure must still produce "[drill] sessions cleared" via the cleanup trap.
# This covers the --keep scenario where the DB is kept for a real recovery.
_MOCK_SC_BIN="$(mktemp -d -t restore-drill-sc.XXXXXXXX)"

# aws: succeed for s3api magic header; fail for all other calls (not needed here)
cat > "${_MOCK_SC_BIN}/aws" <<SCMOCKEOF
#!/usr/bin/env bash
if [[ "\$*" == *"s3api"* ]]; then
  printf 'age-encryption.org/v1' > "\${@: -1}"
  exit 0
fi
exit 1
SCMOCKEOF
chmod +x "${_MOCK_SC_BIN}/aws"

# psql: succeed for CREATE/DROP; fail when -f is passed (db-setup.sql step)
cat > "${_MOCK_SC_BIN}/psql" <<'SCMOCKEOF'
#!/usr/bin/env bash
for arg in "$@"; do
  if [[ "$arg" == "-f" ]]; then
    exit 1
  fi
done
exit 0
SCMOCKEOF
chmod +x "${_MOCK_SC_BIN}/psql"

for _sc_cmd in age pg_restore python3; do
  printf '#!/usr/bin/env bash\nexit 0\n' > "${_MOCK_SC_BIN}/${_sc_cmd}"
  chmod +x "${_MOCK_SC_BIN}/${_sc_cmd}"
done

_sc_rc=0
_sc_out=$(
  PATH="${_MOCK_SC_BIN}:${PATH}" \
  BACKUP_S3_BUCKET=testbucket \
  RESTORE_S3_ACCESS_KEY_ID=testkey \
  RESTORE_S3_SECRET_ACCESS_KEY=testsecret \
  RESTORE_ADMIN_DATABASE_URL="postgresql://u:p@localhost:5432/postgres" \
  bash "$SCRIPT" \
    --key db/daily/2026-11-05T19-15-00Z.dump.age \
    --skip-rpo \
    findmyjob_restore_drill \
    <<< "AGE-SECRET-KEY-1TESTKEY000000000000000000000000000000000000000000000000" \
    2>&1
) || _sc_rc=$?

if [ "$_sc_rc" -eq 0 ]; then
  echo "FAIL: session-cleared-on-failure — script should have exited non-zero (db-setup failed)"
  FAIL=$(( FAIL + 1 ))
elif echo "$_sc_out" | grep -q "\[drill\] sessions cleared"; then
  echo "PASS: session-cleared-on-failure — '[drill] sessions cleared' in output even on check failure"
  PASS=$(( PASS + 1 ))
else
  echo "FAIL: session-cleared-on-failure — '[drill] sessions cleared' missing from output"
  echo "      exit code: ${_sc_rc}"
  echo "      output: ${_sc_out}"
  FAIL=$(( FAIL + 1 ))
fi

# same with --keep: session must still be cleared even when DB is retained
_sc_keep_rc=0
_sc_keep_out=$(
  PATH="${_MOCK_SC_BIN}:${PATH}" \
  BACKUP_S3_BUCKET=testbucket \
  RESTORE_S3_ACCESS_KEY_ID=testkey \
  RESTORE_S3_SECRET_ACCESS_KEY=testsecret \
  RESTORE_ADMIN_DATABASE_URL="postgresql://u:p@localhost:5432/postgres" \
  bash "$SCRIPT" \
    --key db/daily/2026-11-05T19-15-00Z.dump.age \
    --skip-rpo --keep \
    findmyjob_restore_drill \
    <<< "AGE-SECRET-KEY-1TESTKEY000000000000000000000000000000000000000000000000" \
    2>&1
) || _sc_keep_rc=$?

if [ "$_sc_keep_rc" -eq 0 ]; then
  echo "FAIL: session-cleared-on-failure --keep — script should have exited non-zero"
  FAIL=$(( FAIL + 1 ))
elif echo "$_sc_keep_out" | grep -q "\[drill\] sessions cleared"; then
  echo "PASS: session-cleared-on-failure --keep — '[drill] sessions cleared' present"
  PASS=$(( PASS + 1 ))
else
  echo "FAIL: session-cleared-on-failure --keep — '[drill] sessions cleared' missing"
  echo "      exit code: ${_sc_keep_rc}"
  echo "      output: ${_sc_keep_out}"
  FAIL=$(( FAIL + 1 ))
fi

rm -rf "${_MOCK_SC_BIN}"
unset _MOCK_SC_BIN _sc_cmd _sc_rc _sc_out _sc_keep_rc _sc_keep_out

# ── --keep + failure drops DB (not retained as half-finished restore) ─────────
# When --keep is passed but the restore fails (RESTORE_COMPLETE stays 0),
# the drill database must still be dropped. Prior to the RESTORE_COMPLETE fix,
# --keep always retained the DB even on failure, leaving a potentially corrupted
# half-finished database behind.
_MOCK_KD_BIN="$(mktemp -d -t restore-drill-kd.XXXXXXXX)"
cat > "${_MOCK_KD_BIN}/aws" <<KDMOCKEOF
#!/usr/bin/env bash
if [[ "\$*" == *"s3api"* ]]; then
  printf 'age-encryption.org/v1' > "\${@: -1}"
  exit 0
fi
exit 1
KDMOCKEOF
chmod +x "${_MOCK_KD_BIN}/aws"
cat > "${_MOCK_KD_BIN}/psql" <<'KDMOCKEOF'
#!/usr/bin/env bash
for arg in "$@"; do
  if [[ "$arg" == "-f" ]]; then exit 1; fi
done
exit 0
KDMOCKEOF
chmod +x "${_MOCK_KD_BIN}/psql"
for _kd_cmd in age pg_restore python3; do
  printf '#!/usr/bin/env bash\nexit 0\n' > "${_MOCK_KD_BIN}/${_kd_cmd}"
  chmod +x "${_MOCK_KD_BIN}/${_kd_cmd}"
done

_kd_rc=0
_kd_out=$(
  PATH="${_MOCK_KD_BIN}:${PATH}" \
  BACKUP_S3_BUCKET=testbucket \
  RESTORE_S3_ACCESS_KEY_ID=testkey \
  RESTORE_S3_SECRET_ACCESS_KEY=testsecret \
  RESTORE_ADMIN_DATABASE_URL="postgresql://u:p@localhost:5432/postgres" \
  bash "$SCRIPT" \
    --key db/daily/2026-11-05T19-15-00Z.dump.age \
    --skip-rpo --keep \
    findmyjob_restore_drill \
    <<< "AGE-SECRET-KEY-1TESTKEY000000000000000000000000000000000000000000000000" \
    2>&1
) || _kd_rc=$?

if [ "$_kd_rc" -eq 0 ]; then
  echo "FAIL: --keep+failure-drops-DB — script should exit non-zero (db-setup failed)"
  FAIL=$(( FAIL + 1 ))
elif echo "$_kd_out" | grep -q "\[drill\] drill database dropped"; then
  echo "PASS: --keep+failure-drops-DB — '[drill] drill database dropped' present even with --keep"
  PASS=$(( PASS + 1 ))
else
  echo "FAIL: --keep+failure-drops-DB — '[drill] drill database dropped' missing; output: ${_kd_out}"
  FAIL=$(( FAIL + 1 ))
fi

rm -rf "${_MOCK_KD_BIN}"
unset _MOCK_KD_BIN _kd_cmd _kd_rc _kd_out

# ── counts.json missing table → fail ─────────────────────────────────────────
# When a table listed in the expected set is absent from counts.json, the check
# must fail (exit 1) with an informative error.  Previously the Python loop used
# 'continue', silently accepting incomplete counts files.
# Uses 'python' (Anaconda, confirmed available) since python3 is not usable here.
_PYBIN=""
for _pb in python python3; do
  if "$_pb" -c 'import sys; sys.exit(0)' 2>/dev/null; then
    _PYBIN="$_pb"
    break
  fi
done

if [ -z "$_PYBIN" ]; then
  echo "SKIP: counts.json-missing-table — no working python found"
  PASS=$(( PASS + 1 ))   # treat as SKIP/PASS to not block the suite
else
  _cj_tmp="$(mktemp -t restore-test-counts.XXXXXXXX.json)"
  # counts.json with User/StudentProfile/Company but missing Job/Application/CreditLedger/AuditLog
  printf '{"timestamp":"2026-11-07T00:00:00Z","User":10,"StudentProfile":5,"Company":3}' > "$_cj_tmp"

  # Write Python to a temp file; heredoc-inside-$() loses the exit code when
  # the redirects appear after the heredoc delimiter (bash parses them as a
  # separate no-op command). Using a file avoids that shell parsing edge-case.
  _cj_py="$(mktemp -t restore-test-counts-py.XXXXXXXX.py)"
  cat > "$_cj_py" <<'PYEOF_CHECK'
import sys, json

counts_file = sys.argv[1]
expected = json.load(open(counts_file))
tables = ["User", "StudentProfile", "Company", "Job", "Application", "CreditLedger", "AuditLog"]
failures = []

for table in tables:
    if table not in expected:
        failures.append(f"{table}: missing from counts.json")
        continue
    actual = expected.get(table, 0)
    exp = expected[table]
    if actual != exp:
        failures.append(f"{table}: expected {exp}, got {actual}")

if failures:
    print("FAIL: counts.json mismatch:", ", ".join(failures), file=sys.stderr)
    sys.exit(1)
print(f"[check] counts.json: all {len(tables)} tables match")
PYEOF_CHECK

  _cj_rc=0
  _cj_err_file="$(mktemp -t restore-test-cj-err.XXXXXXXX.txt)"
  "$_PYBIN" "$_cj_py" "$_cj_tmp" >/dev/null 2>"$_cj_err_file" || _cj_rc=$?
  _cj_captured="$(cat "$_cj_err_file" 2>/dev/null || true)"
  rm -f "$_cj_tmp" "$_cj_py" "$_cj_err_file"

  if [ "$_cj_rc" -ne 0 ] && echo "$_cj_captured" | grep -q "missing from counts.json"; then
    echo "PASS: counts.json-missing-table — exits non-zero with 'missing from counts.json' message"
    PASS=$(( PASS + 1 ))
  else
    echo "FAIL: counts.json-missing-table — expected failure with 'missing from counts.json' (rc=${_cj_rc}, captured=${_cj_captured})"
    FAIL=$(( FAIL + 1 ))
  fi
  unset _cj_tmp _cj_rc _cj_py _cj_err_file _cj_captured
fi
unset _PYBIN _pb

# ── summary ───────────────────────────────────────────────────────────────────
echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ] || exit 1
