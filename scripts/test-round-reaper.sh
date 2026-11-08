#!/usr/bin/env bash
# Fake-round test for round-reaper.ps1.
# Expect: the node started by the fake round (left behind after the round's shell exits) is ended;
# a node started outside the round is still alive. Both test nodes exit on their own (90 s / 120 s),
# so nothing is left behind even if the test fails.
set -u
REAPER="${1:?path to round-reaper.ps1}"
WORK="$(mktemp -d)"
TREE="$WORK/tree.tsv"
STOP="$WORK/tree.stop"
win() { cygpath -w "$1"; }
alive() { tasklist //FI "PID eq $1" 2>/dev/null | grep -q " $1 "; }

# Unrelated node, outside the round
node -e "setTimeout(()=>{},90000)" &
outside_win=$(cat /proc/$!/winpid)

# Fake round: spawns a long-lived node, then the round shell itself exits after 25 s
cat >"$WORK/fake-round.sh" <<'EOF'
node -e "setTimeout(()=>{},120000)" &
echo "leftover_win=$(cat /proc/$!/winpid)" > "$1"
sleep 25
EOF
bash "$WORK/fake-round.sh" "$WORK/leftover.txt" &
round_pid=$!
round_win=$(cat /proc/$round_pid/winpid)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(win "$REAPER")" -Mode watch -RootPid "$round_win" -Out "$(win "$TREE")" -StopFile "$(win "$STOP")" -IntervalSec 5 &
watcher=$!
wait "$round_pid"
: >"$STOP"
wait "$watcher"
. "$WORK/leftover.txt"
echo "round root=$round_win leftover=$leftover_win outside=$outside_win"
echo "--- recorded tree:"; cat "$TREE"
alive "$leftover_win" && echo "before reap: leftover alive (expected)" || echo "before reap: leftover NOT alive (test invalid)"
echo "--- reap:"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(win "$REAPER")" -Mode reap -Out "$(win "$TREE")"
sleep 2
fail=0
if alive "$leftover_win"; then echo "FAIL: leftover node $leftover_win still alive"; fail=1; else echo "PASS: leftover node reaped"; fi
if alive "$outside_win"; then echo "PASS: outside node $outside_win untouched"; else echo "FAIL: outside node was ended"; fail=1; fi
exit $fail
