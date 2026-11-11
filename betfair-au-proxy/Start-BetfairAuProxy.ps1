$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Read-SecretText([string]$Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js 22 or newer is required. Install the LTS release from https://nodejs.org/ and reopen PowerShell."
}
$nodeVersion = (node -p "process.versions.node").Split('.')[0]
if ([int]$nodeVersion -lt 22) { throw "Node.js 22 or newer is required. Detected $(node --version)." }

Write-Host "Betfair Australian read-only adapter. Secrets are entered locally and are not written to this script."
$env:BETFAIR_APP_KEY = Read-SecretText "Betfair delayed app key"
$env:BETFAIR_SESSION_TOKEN = Read-SecretText "Betfair session token"
$env:BETFAIR_FEED_TOKEN = Read-SecretText "Shared adapter token (must exactly match Railway BETFAIR_FEED_TOKEN)"
$env:PORT = "8080"

if ([string]::IsNullOrWhiteSpace($env:BETFAIR_APP_KEY) -or
    [string]::IsNullOrWhiteSpace($env:BETFAIR_SESSION_TOKEN) -or
    [string]::IsNullOrWhiteSpace($env:BETFAIR_FEED_TOKEN)) {
  throw "All three values are required. No service was started."
}

Write-Host "Starting local adapter on 127.0.0.1:8080. Keep this window open."
Write-Host "In a second Administrator PowerShell window, enable Tailscale Funnel with: tailscale funnel --bg 8080"
Write-Host "Then copy the HTTPS URL shown by: tailscale funnel status"
node server.js
