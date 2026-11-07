#!/usr/bin/env bash
# Tests for findmyjob-deploy's image step, using a stub `docker` on PATH.
# Run: bash deploy/server/findmyjob-deploy.test.sh
#
# Covered:
#   - FINDMYJOB_SKIP_PULL=1: no `docker pull`; each image is checked with `docker image inspect`
#   - FINDMYJOB_SKIP_PULL=1 with a missing image: exits non-zero before any later step
#   - default (no switch): the three images are pulled
#   - locally loaded images have no RepoDigests: the digest is reported as "unknown", never ""
#     (both when docker inspect fails and when it prints nothing)
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/findmyjob-deploy"
SHA="0123456789abcdef0123456789abcdef01234567"
PASS=0
FAIL=0

setup() {
  T="$(mktemp -d)"
  mkdir -p "$T/bin" "$T/work/env"
  echo "APP_TAG=ffffffffffffffffffffffffffffffffffffffff" > "$T/work/.env"
  : > "$T/work/docker-compose.prod.yml"
  CALLS="$T/calls.log"
  cat > "$T/bin/docker" <<'STUB'
#!/usr/bin/env bash
echo "$*" >> "$DOCKER_CALLS"
case "$1" in
  pull) exit 0 ;;
  image)
    # `docker image inspect <ref>`: fail only for the ref named in DOCKER_MISSING
    if [[ -n "${DOCKER_MISSING:-}" && "$*" == *"$DOCKER_MISSING"* ]]; then exit 1; fi
    exit 0 ;;
  inspect)
    # `docker inspect --format '{{index .RepoDigests 0}}'`: a docker-load'ed image has no RepoDigests.
    # Real docker exits non-zero here; DOCKER_INSPECT_EMPTY=1 simulates exit 0 with empty output.
    [ "${DOCKER_INSPECT_EMPTY:-0}" = "1" ] && exit 0
    exit 1 ;;
  *) exit 97 ;;   # compose/run/...: stop the script after the image step
esac
STUB
  chmod +x "$T/bin/docker"
}

run_deploy() {
  # shellcheck disable=SC2086
  env PATH="$T/bin:$PATH" DOCKER_CALLS="$CALLS" FINDMYJOB_WORKDIR="$T/work" "$@" \
    bash "$SCRIPT" deploy "$SHA" ${EXTRA_ARGS:-} >"$T/out.log" 2>&1
  echo $?
}

check() {
  local name="$1" cond="$2"
  if eval "$cond"; then echo "PASS: $name"; PASS=$((PASS + 1))
  else echo "FAIL: $name"; echo "  --- calls:"; sed 's/^/    /' "$CALLS" 2>/dev/null; echo "  --- output:"; sed 's/^/    /' "$T/out.log"; FAIL=$((FAIL + 1)); fi
}

# 1. FINDMYJOB_SKIP_PULL=1, all images present locally
setup
rc=$(run_deploy FINDMYJOB_SKIP_PULL=1)
check "skip-pull: no docker pull" "! grep -q '^pull ' '$CALLS'"
check "skip-pull: three images checked locally" "[ \"\$(grep -c '^image inspect ' '$CALLS')\" -eq 3 ]"
check "skip-pull: reached the step after the image step (stub exit 97)" "[ '$rc' -ne 0 ] && grep -qvE '^(pull|image|inspect) ' '$CALLS'"
rm -rf "$T"

# 2. FINDMYJOB_SKIP_PULL=1, migrate image missing
setup
rc=$(DOCKER_MISSING="findmyjob-migrate:$SHA" run_deploy FINDMYJOB_SKIP_PULL=1 DOCKER_MISSING="findmyjob-migrate:$SHA")
check "skip-pull missing image: exits non-zero" "[ '$rc' -ne 0 ]"
check "skip-pull missing image: says the image is not present locally" "grep -q 'not present locally' '$T/out.log'"
check "skip-pull missing image: stops before compose/run" "! grep -qvE '^(pull|image|inspect) ' '$CALLS'"
rm -rf "$T"

# 3. default: images are pulled from the registry
setup
rc=$(run_deploy)
check "default: three docker pull calls" "[ \"\$(grep -c '^pull ' '$CALLS')\" -eq 3 ]"
rm -rf "$T"

# 4. no RepoDigests: digest is reported as "unknown", not an empty string
setup
rc=$(EXTRA_ARGS="--expect-digest sha256:$(printf '0%.0s' {1..64})" run_deploy FINDMYJOB_SKIP_PULL=1)
check "no RepoDigests: mismatch message says 'got unknown'" "grep -q 'got unknown' '$T/out.log'"
rm -rf "$T"

# 5. inspect exits 0 but prints nothing: still "unknown" (never an empty field in deploy-history.log)
setup
rc=$(EXTRA_ARGS="--expect-digest sha256:$(printf '0%.0s' {1..64})" run_deploy FINDMYJOB_SKIP_PULL=1 DOCKER_INSPECT_EMPTY=1)
check "empty inspect output: mismatch message says 'got unknown'" "grep -q 'got unknown' '$T/out.log'"
rm -rf "$T"

echo
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
