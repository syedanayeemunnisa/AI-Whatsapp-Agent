# Removes the Phase 5 autostart tasks created by install-autostart.ps1.
$ErrorActionPreference = 'Continue'
foreach ($name in @('WA-Agent Ollama', 'WA-Agent Backend')) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Removed scheduled task (if present): $name"
}
