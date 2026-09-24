# Phase 5 (task §54): run the local automation stack at logon.
# Creates two Scheduled Tasks (highest privileges not required):
#   - WA-Agent Ollama  : ollama serve on 127.0.0.1:11434
#   - WA-Agent Backend : node server.js on 127.0.0.1:4000
# Idempotent: re-running replaces the tasks. Remove with scripts\remove-autostart.ps1.

$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $repo 'backend'
$ollamaExe = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'

if (-not (Test-Path $ollamaExe)) {
  Write-Warning "Ollama not found at $ollamaExe — skipping the Ollama task."
}

$backendCmd = "/c cd /d `"$backend`" && node server.js > server.log 2>&1"
$ollamaCmd  = "/c `"$ollamaExe`" serve > `"$env:LOCALAPPDATA\ollama-serve.log`" 2>&1"

foreach ($spec in @(
  @{ Name = 'WA-Agent Ollama';  Cmd = $ollamaCmd;  Exe = $ollamaExe },
  @{ Name = 'WA-Agent Backend'; Cmd = $backendCmd; Exe = 'node.exe' }
)) {
  if ($spec.Exe -eq 'node.exe') {
    $node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
    if (-not $node) { Write-Warning 'node.exe not on PATH — skipping backend task.'; continue }
    $action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $spec.Cmd
  } else {
    $action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $spec.Cmd
  }
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBattery -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName $spec.Name -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
  Write-Host "Registered scheduled task: $($spec.Name)"
}

Write-Host "`nDone. Both tasks start at your next logon. Start them now with:"
Write-Host "  Start-ScheduledTask -TaskName 'WA-Agent Ollama'"
Write-Host "  Start-ScheduledTask -TaskName 'WA-Agent Backend'"
