#!/usr/bin/env bash
# Fake-round test for round-reaper.ps1 (in-memory tree, reaps when the stop file appears).
# Expect:
#   - the node the fake round left behind is ended;
#   - a node started outside the round survives, even though its PID + real CreationDate were
#     injected into the watcher's log file while the round ran (the log is never read back).
# Both test nodes exit on their own (90 s / 120 s), so nothing lingers even if the test fails.
set -u
REAPER="${1:?path to round-reaper.ps1}"
WORK="$(mktemp -d)"
LOG="$WORK/tree.tsv"
STOP="$WORK/tree.stop"
win() { cygpath -w "$1"; }
alive() { tasklist //FI "PID eq $1" 2>/dev/null | grep -q " $1 "; }

node -e "setTimeout(()=>{},90000)" &
outside_win=$(cat /proc/$!/winpid)

cat >"$WORK/fake-round.sh" <<'EOF'
node -e "setTimeout(()=>{},120000)" &
echo "leftover_win=$(cat /proc/$!/winpid)" > "$1"
sleep 25
EOF
bash "$WORK/fake-round.sh" "$WORK/leftover.txt" &
round_pid=$!
round_win=$(cat /proc/$round_pid/winpid)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(win "$REAPER")" -RootPid "$round_win" -Log "$(win "$LOG")" -StopFile "$(win "$STOP")" -IntervalSec 5 -DryRun >"$WORK/reap.out" 2>&1 &
watcher=$!

# Injection attempt: append the outside node with its real CreationDate ticks to the log
sleep 8
ticks=$(powershell.exe -NoProfile -Command "([datetime](Get-CimInstance Win32_Process -Filter 'ProcessId=$outside_win').CreationDate).ToUniversalTime().Ticks" | tr -d '\r')
printf '%s\t%s\tnode.exe\n' "$outside_win" "$ticks" >>"$LOG"

wait "$round_pid"
: >"$STOP"
wait "$watcher"
. "$WORK/leftover.txt"
echo "round root=$round_win leftover=$leftover_win outside=$outside_win (injected into log)"
echo "--- log:"; cat "$LOG"
echo "--- reaper output:"; cat "$WORK/reap.out"
sleep 2
fail=0
if alive "$leftover_win"; then echo "FAIL: leftover node $leftover_win still alive"; fail=1; else echo "PASS: leftover node reaped"; fi
if alive "$outside_win"; then echo "PASS: outside node $outside_win untouched despite injection"; else echo "FAIL: outside node was ended"; fail=1; fi
exit $fail
