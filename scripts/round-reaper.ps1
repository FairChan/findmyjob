# round-reaper.ps1 - end leftover processes that one unattended round started, and nothing else.
#
# Why: a round's background vitest (moved to the background after the 600 s Bash limit) kept running
# after the round ended and held the test-DB lock / TRUNCATEd tables under later runs.
# The user approved (2026-11-08, controller session) that auto-build may end leftover processes
# from its own rounds. Only the exact process tree of the round is touched: every PID is recorded
# together with its CreationDate while the round runs, and at the end a PID is ended only if it is
# still alive with the SAME CreationDate (protects against PID reuse). Processes of other worktrees,
# other sessions, or the controller's verify are never in the tree, so they are never touched.
#
#   watch: -RootPid <windows pid> -Out <tsv> -StopFile <path>
#          every 10 s snapshot all descendants of RootPid and of every already-recorded PID
#          (so orphans whose parent has exited are still followed), append new "pid<TAB>ticks" rows.
#   reap:  -Out <tsv>   end each recorded process that is still alive with a matching CreationDate.
param(
  [Parameter(Mandatory = $true)][ValidateSet('watch', 'reap')][string]$Mode,
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$RootPid = 0,
  [string]$StopFile = '',
  [int]$IntervalSec = 10
)
$ErrorActionPreference = 'Continue'

function Get-Procs {
  Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, CreationDate, Name
}

function Get-Ticks($p) {
  if ($null -eq $p.CreationDate) { return 0 }
  return ([datetime]$p.CreationDate).ToUniversalTime().Ticks
}

if ($Mode -eq 'watch') {
  if ($RootPid -le 0) { Write-Error 'watch needs -RootPid'; exit 2 }
  $known = @{}   # pid -> ticks
  $all = Get-Procs
  $root = $all | Where-Object { $_.ProcessId -eq $RootPid } | Select-Object -First 1
  if ($null -ne $root) {
    $known[[int]$RootPid] = Get-Ticks $root
    Add-Content -LiteralPath $Out -Value ("{0}`t{1}`t{2}" -f $RootPid, $known[[int]$RootPid], $root.Name)
  }
  while ($true) {
    $all = Get-Procs
    $byParent = @{}
    foreach ($p in $all) {
      $pp = [int]$p.ParentProcessId
      if (-not $byParent.ContainsKey($pp)) { $byParent[$pp] = New-Object System.Collections.ArrayList }
      [void]$byParent[$pp].Add($p)
    }
    $queue = New-Object System.Collections.Queue
    foreach ($k in @($known.Keys)) { $queue.Enqueue([int]$k) }
    while ($queue.Count -gt 0) {
      $cur = [int]$queue.Dequeue()
      if (-not $byParent.ContainsKey($cur)) { continue }
      foreach ($child in $byParent[$cur]) {
        $cid = [int]$child.ProcessId
        $ct = Get-Ticks $child
        # A child must have been created after its parent; otherwise this is PID reuse of an old parent id.
        if ($known.ContainsKey($cur) -and $ct -lt $known[$cur]) { continue }
        if (-not $known.ContainsKey($cid)) {
          $known[$cid] = $ct
          Add-Content -LiteralPath $Out -Value ("{0}`t{1}`t{2}" -f $cid, $ct, $child.Name)
          $queue.Enqueue($cid)
        }
      }
    }
    if ($StopFile -and (Test-Path -LiteralPath $StopFile)) { break }
    Start-Sleep -Seconds $IntervalSec
  }
  exit 0
}

if ($Mode -eq 'reap') {
  if (-not (Test-Path -LiteralPath $Out)) { Write-Output 'reap: no tree file, nothing to do'; exit 0 }
  $rows = Get-Content -LiteralPath $Out | Where-Object { $_ -match '^\d+\t\d+' }
  $alive = @{}
  foreach ($p in Get-Procs) { $alive[[int]$p.ProcessId] = $p }
  $killed = 0
  foreach ($r in $rows) {
    $parts = $r -split "`t"
    $procId = [int]$parts[0]
    $ticks = [int64]$parts[1]
    if (-not $alive.ContainsKey($procId)) { continue }
    $p = $alive[$procId]
    if ((Get-Ticks $p) -ne $ticks) { Write-Output ("reap: skip pid {0} ({1}): CreationDate differs, PID reused" -f $procId, $p.Name); continue }
    & taskkill.exe /PID $procId /T /F *> $null
    if ($LASTEXITCODE -eq 0) { $killed++; Write-Output ("reap: ended pid {0} ({1})" -f $procId, $p.Name) }
  }
  Write-Output ("reap: {0} leftover process(es) ended" -f $killed)
  exit 0
}
