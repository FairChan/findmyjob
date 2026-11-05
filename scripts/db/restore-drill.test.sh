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

# ── summary ───────────────────────────────────────────────────────────────────
echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ] || exit 1
