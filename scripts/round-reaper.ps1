# round-reaper.ps1 - end leftover processes that one unattended round started, and nothing else.
#
# Why: a round's background vitest kept running after the round ended, held the test-DB lock and
# TRUNCATEd tables under later runs. The user approved (2026-11-08, controller session) that auto-build
# may end leftover processes from its own rounds.
#
# Safety (hardened after the 2026-11-08 security review):
# - auto-build runs a copy of this script from a temp dir outside the repo and checks its sha256 first,
#   so a round cannot change what auto-build executes.
# - The process tree lives only in this watcher's memory; nothing is read back from a file, so a round
#   cannot inject PIDs. The tree file written next to it is a log only.
# - A recorded PID is expanded only while the live process holding it still has the recorded CreationDate
#   (or no process holds it any more - then its orphaned children are still followed).
# - A PID is ended only if it is alive with the SAME CreationDate as recorded (protects against PID reuse),
#   and never if it is this script or one of its own ancestors (auto-build / the controller).
#
#   watch: -RootPid <windows pid> -Log <tsv> -StopFile <path>
#          snapshot every IntervalSec; when StopFile appears, take a final snapshot, then end the
#          recorded processes that are still alive, print what was ended, and exit.
param(
  [Parameter(Mandatory = $true)][int]$RootPid,
  [Parameter(Mandatory = $true)][string]$Log,
  [Parameter(Mandatory = $true)][string]$StopFile,
  [int]$IntervalSec = 10,
  [switch]$DryRun
)
$ErrorActionPreference = 'Continue'

function Get-Procs { Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, CreationDate, Name }
function Get-Ticks($p) { if ($null -eq $p.CreationDate) { return 0 }; return ([datetime]$p.CreationDate).ToUniversalTime().Ticks }

# This script's own ancestry (powershell -> bash auto-build -> ... -> controller): never ended.
$protected = @{}
$all0 = Get-Procs
$byId0 = @{}; foreach ($p in $all0) { $byId0[[int]$p.ProcessId] = $p }
$cur = [int]$PID
for ($n = 0; $n -lt 64 -and $byId0.ContainsKey($cur); $n++) {
  $protected[$cur] = $true
  $parent = [int]$byId0[$cur].ParentProcessId
  if ($parent -eq $cur -or $parent -le 0) { break }
  $cur = $parent
}

$known = @{}   # pid -> creation ticks (in memory only)
$script:lastSeen = @{}   # pid -> last time (UTC ticks) we saw it alive with the recorded CreationDate
function Add-Known($p) {
  $id = [int]$p.ProcessId
  if ($protected.ContainsKey($id) -or $known.ContainsKey($id)) { return $false }
  $known[$id] = Get-Ticks $p
  $script:lastSeen[$id] = (Get-Date).ToUniversalTime().Ticks
  Add-Content -LiteralPath $Log -Value ("{0}`t{1}`t{2}" -f $id, $known[$id], $p.Name)
  return $true
}

function Snapshot {
  $all = Get-Procs
  $byId = @{}; $byParent = @{}
  foreach ($p in $all) {
    $byId[[int]$p.ProcessId] = $p
    $pp = [int]$p.ParentProcessId
    if (-not $byParent.ContainsKey($pp)) { $byParent[$pp] = New-Object System.Collections.ArrayList }
    [void]$byParent[$pp].Add($p)
  }
  $queue = New-Object System.Collections.Queue
  foreach ($k in @($known.Keys)) { $queue.Enqueue([int]$k) }
  while ($queue.Count -gt 0) {
    $id = [int]$queue.Dequeue()
    # Expand only while the PID is still ours (same CreationDate). If nobody holds it any more, adopt only
    # children created no later than one interval after we last saw it alive (a later child belongs to whoever reused the PID).
    $cutoff = [int64]::MaxValue
    if ($byId.ContainsKey($id)) {
      if ((Get-Ticks $byId[$id]) -ne $known[$id]) { continue }
      $script:lastSeen[$id] = (Get-Date).ToUniversalTime().Ticks
    } else {
      $cutoff = $script:lastSeen[$id] + [int64]$IntervalSec * 10000000
    }
    if (-not $byParent.ContainsKey($id)) { continue }
    foreach ($child in $byParent[$id]) {
      if ((Get-Ticks $child) -lt $known[$id]) { continue }   # created before the parent: PID reuse
      if ((Get-Ticks $child) -gt $cutoff) { continue }       # created after the parent died: someone else's
      if (Add-Known $child) { $queue.Enqueue([int]$child.ProcessId) }
    }
  }
}

$root = $byId0[[int]$RootPid]
if ($null -eq $root) { Write-Output "reap: root pid $RootPid not found, nothing watched"; exit 0 }
[void](Add-Known $root)
while (-not (Test-Path -LiteralPath $StopFile)) {
  Snapshot
  Start-Sleep -Seconds $IntervalSec
}
Snapshot

$alive = @{}; foreach ($p in Get-Procs) { $alive[[int]$p.ProcessId] = $p }
$ended = 0
# End only recorded PIDs, one at a time and newest first (never taskkill /T: that would also end children we never recorded).
foreach ($id in @($known.Keys | Sort-Object { $known[$_] } -Descending)) {
  if ($protected.ContainsKey($id) -or -not $alive.ContainsKey($id)) { continue }
  $p = $alive[$id]
  if ((Get-Ticks $p) -ne $known[$id]) { Write-Output ("reap: skip pid {0} ({1}): CreationDate differs, PID reused" -f $id, $p.Name); continue }
  if ($DryRun) { Write-Output ("reap: would end pid {0} ({1})" -f $id, $p.Name); continue }
  & taskkill.exe /PID $id /F *> $null
  if ($LASTEXITCODE -eq 0) { $ended++; Write-Output ("reap: ended pid {0} ({1})" -f $id, $p.Name) }
  else { Write-Output ("reap: taskkill pid {0} ({1}) exit {2}" -f $id, $p.Name, $LASTEXITCODE) }
}
if ($DryRun) { Write-Output "reap: dry run, nothing ended" } else { Write-Output ("reap: {0} leftover process(es) ended" -f $ended) }
exit 0
