# Freebuff-independent stack watchdog
# ------------------------------------
# Ensures the backend (node server.js) and a cloudflared quick-tunnel are up,
# captures the CURRENT tunnel URL, updates frontend/.env.production and pushes
# to GitHub when it changes - so Cloudflare Pages rebuilds with the right URL
# automatically. Run at logon (Scheduled Task) or manually.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\stack-watchdog.ps1            # daemon loop
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\stack-watchdog.ps1 -Once      # one pass
#
# Log: scripts\watchdog.log (rotated at ~1 MB)

param([switch]$Once)

$ErrorActionPreference = 'Continue'
$Repo    = Split-Path -Parent $PSScriptRoot   # repo root (script lives in <repo>/scripts)
$Log     = Join-Path $PSScriptRoot 'watchdog.log'
$EnvFile = Join-Path $Repo 'frontend\.env.production'
$TunnelLogDir = Join-Path $env:TEMP 'stack-watchdog'
$LoopSec = 30

function Log($msg) {
  $stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  Add-Content -Path $Log -Value "$stamp $msg" -Encoding UTF8
  if ((Get-Item $Log -ErrorAction SilentlyContinue).Length -gt 1MB) {
    Move-Item -Force $Log "$Log.old" -ErrorAction SilentlyContinue
  }
}

function Start-Backend {
  $health = $null
  try { $health = Invoke-WebRequest -UseBasicParsing -TimeoutSec 4 -Uri 'http://127.0.0.1:4000/api/health' } catch {}
  if ($health -and $health.StatusCode -eq 200) { return $true }
  Log 'backend down - starting node server.js'
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $node) { Log 'FATAL: node.exe not on PATH'; return $false }
  $wd = Join-Path $Repo 'backend'
  Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $wd -WindowStyle Hidden
  for ($i = 0; $i -lt 10; $i++) {
    Start-Sleep -Seconds 2
    try { $health = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri 'http://127.0.0.1:4000/api/health' } catch {}
    if ($health -and $health.StatusCode -eq 200) { Log 'backend OK'; return $true }
  }
  Log 'backend FAILED to come up'
  return $false
}

function Start-Tunnel {
  param([switch]$Force)
  if ($Force) {
    Log 'restarting cloudflared (URL dead or missing)'
    Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 2
  } else {
    $proc = Get-Process cloudflared -ErrorAction SilentlyContinue
    if ($proc) { return }
    Log 'cloudflared not running - starting quick tunnel'
  }
  if (-not (Test-Path $TunnelLogDir)) { New-Item -ItemType Directory -Path $TunnelLogDir -Force | Out-Null }
  $exe = Join-Path $Repo '.tools\cloudflared.exe'
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $outLog = Join-Path $TunnelLogDir "cloudflared-$stamp.log"
  Start-Process -FilePath $exe -ArgumentList 'tunnel','--url','http://localhost:4000' -WindowStyle Hidden `
    -RedirectStandardError $outLog -RedirectStandardOutput "$outLog.out"
  Start-Sleep -Seconds 10
}

function Test-UrlAlive($url) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 -Uri "$url/api/health"
    return ($r.StatusCode -eq 200)
  } catch { return $false }
}

function Get-AliveTunnelUrl {
  # Candidate logs: this watchdog's own tunnel logs + the repo .tools logs
  # (covers tunnels started manually before the watchdog existed).
  $files = @(Get-ChildItem $TunnelLogDir -Filter 'cloudflared-*.log' -ErrorAction SilentlyContinue) +
           @(Get-ChildItem (Join-Path $Repo '.tools') -Filter 'cloudflared*.log' -ErrorAction SilentlyContinue)
  $files = $files | Sort-Object LastWriteTime -Descending
  foreach ($f in $files) {
    $hits = Select-String -Path $f.FullName -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue
    if (-not $hits) { continue }
    $url = $hits[-1].Matches[0].Value   # newest mention in that file
    if (Test-UrlAlive $url) { return $url }
    Log "stale tunnel URL in $($f.Name): $url (not alive)"
  }
  return $null
}

function Update-UrlInRepo($url) {
  if (-not $url) { return $false }
  $current = (Get-Content $EnvFile -Raw -ErrorAction SilentlyContinue) -replace '\r?\n',''
  if ($current -match 'VITE_API_BASE=(\S+)') { $old = $Matches[1] } else { $old = '' }
  if ($old -eq $url) { return $false }
  Log "URL changed: '$old' -> '$url' - updating repo"
  Set-Content -Path $EnvFile -Value "# Production build configuration (baked into the bundle at build time).`r`n# AUTO-UPDATED by scripts/stack-watchdog.ps1 - trycloudflare URLs rotate on restart.`r`nVITE_API_BASE=$url`r`n" -Encoding ASCII
  Push-Location $Repo
  try {
    git add frontend/.env.production 2>&1 | Out-Null
    git commit -m "chore: rotate tunnel URL to $url (auto by watchdog)" 2>&1 | Out-Null
    $pushed = $false
    for ($i = 0; $i -lt 3; $i++) {
      git pull --rebase origin main 2>&1 | Out-Null
      git push origin main 2>&1 | Out-Null
      if ($LASTEXITCODE -eq 0) { $pushed = $true; break }
      Start-Sleep -Seconds 5
    }
    if ($pushed) { Log "pushed OK - Cloudflare Pages will rebuild" } else { Log "push FAILED after 3 attempts" }
  } finally { Pop-Location }
  return $true
}

# ── main ──
Log '=== watchdog starting ==='
if (-not (Test-Path $TunnelLogDir)) {
  New-Item -ItemType Directory -Path $TunnelLogDir -Force | Out-Null
}

do {
  $ok = Start-Backend
  Start-Tunnel

  $url = Get-AliveTunnelUrl
  if ($url) {
    $null = Update-UrlInRepo $url
  } else {
    Log 'no live tunnel URL - forcing a fresh tunnel'
    Start-Tunnel -Force
  }

  if ($Once) { break }
  Start-Sleep -Seconds $LoopSec
} while ($true)
