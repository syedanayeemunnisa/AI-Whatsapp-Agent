# Registers the AIWhatsAppStackWatchdog scheduled task (per-user, no admin).
# ------------------------------------------------------------------------------
# Runs stack-watchdog.ps1 with -Once: at logon, and every 5 minutes afterwards.
#
# Why -Once passes instead of an immortal daemon loop: the long-lived console
# daemon kept getting terminated by app/console lifecycle events
# (LastTaskResult 0xC000013A = console killed), leaving the stack unguarded.
# Short-lived converging passes have nothing to kill; each pass checks backend,
# tunnel and the published URL and exits within ~1 minute.
#
# Re-run this script any time to repair the task:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\register-watchdog-task.ps1
#
# Remove the task with:
#   Unregister-ScheduledTask -TaskName AIWhatsAppStackWatchdog -Confirm:$false

$ErrorActionPreference = 'Stop'

$Repo     = Split-Path -Parent $PSScriptRoot
$TaskName = 'AIWhatsAppStackWatchdog'
$Script   = Join-Path $PSScriptRoot 'stack-watchdog.ps1'
$Pwsh     = (Get-Command powershell.exe).Source
$Me       = "$env:USERDOMAIN\$env:USERNAME"

$Action = New-ScheduledTaskAction -Execute $Pwsh `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Script`" -Once" `
  -WorkingDirectory $Repo

# Trigger 1: right after logon (covers PC reboots).
$tLogon = New-ScheduledTaskTrigger -AtLogOn -User $Me

# Trigger 2: every 5 minutes. PS 5.1 rejects [TimeSpan]::MaxValue as duration,
# so use 10 years (~= indefinite).
$tRepeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(-1) `
  -RepetitionInterval (New-TimeSpan -Minutes 5) `
  -RepetitionDuration (New-TimeSpan -Days 3650)

$Settings = New-ScheduledTaskSettingsSet -Hidden `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -MultipleInstances IgnoreNew `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 15)

Register-ScheduledTask -TaskName $TaskName -Action $Action `
  -Trigger @($tLogon, $tRepeat) -Settings $Settings -Force | Out-Null

Write-Output "Registered $TaskName (logon + every 5 minutes, -Once mode)"
(Get-ScheduledTask -TaskName $TaskName).State
