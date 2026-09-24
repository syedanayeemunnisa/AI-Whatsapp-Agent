$procs = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'"
$killed = 0
foreach ($p in $procs) {
  if ($p.CommandLine -and ($p.CommandLine -like '*wwebjs_auth*' -or $p.CommandLine -like '*ai-whatsapp-agent*')) {
    Write-Output ("killing " + $p.ProcessId)
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    $killed++
  }
}
Write-Output ("done, killed " + $killed)
