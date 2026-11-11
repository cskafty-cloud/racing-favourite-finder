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

Write-Host ""
Write-Host "BETFAIR AUSTRALIAN READ-ONLY ADAPTER CONFIGURATION" -ForegroundColor Cyan
Write-Host "You must enter THREE separate values. They are not interchangeable:"
Write-Host "  1. BETFAIR_APP_KEY       = App key from your Betfair developer/API account"
Write-Host "  2. BETFAIR_SESSION_TOKEN = Active Betfair login session token"
Write-Host "  3. BETFAIR_FEED_TOKEN    = Your own shared secret; must exactly match Railway's BETFAIR_FEED_TOKEN"
Write-Host ""
Write-Host "Get the Betfair app key/session token from Betfair's authorised API access."
Write-Host "If you do not have those credentials, stop here: the shared feed token alone cannot authenticate to Betfair."
Write-Host "Values are entered as secure prompts and are not written to this script or a .env file."
Write-Host ""

$env:BETFAIR_APP_KEY = Read-SecretText "1/3 - Betfair app key (BETFAIR_APP_KEY)"
$env:BETFAIR_SESSION_TOKEN = Read-SecretText "2/3 - Betfair session token (BETFAIR_SESSION_TOKEN)"
$env:BETFAIR_FEED_TOKEN = (Read-SecretText "3/3 - Shared token (BETFAIR_FEED_TOKEN; same value as Railway)").Trim()
$env:PORT = "8080"

$missing = @()
if ([string]::IsNullOrWhiteSpace($env:BETFAIR_APP_KEY)) { $missing += "BETFAIR_APP_KEY" }
if ([string]::IsNullOrWhiteSpace($env:BETFAIR_SESSION_TOKEN)) { $missing += "BETFAIR_SESSION_TOKEN" }
if ([string]::IsNullOrWhiteSpace($env:BETFAIR_FEED_TOKEN)) { $missing += "BETFAIR_FEED_TOKEN" }
if ($missing.Count -gt 0) { throw ("Missing required values: " + ($missing -join ", ") + ". No service was started.") }

if ($env:BETFAIR_FEED_TOKEN -notmatch '^[a-fA-F0-9]{64}$') {
  Write-Warning "The shared token is not 64 hexadecimal characters. This can still work if Railway has the identical value, but check for pasted commands or spaces."
}

Write-Host "Configuration loaded into this PowerShell process (secret values hidden)." -ForegroundColor Green
Write-Host "Starting local adapter on 127.0.0.1:8080. Keep this window open."
Write-Host "In a second PowerShell window, run: tailscale funnel --bg 8080"
Write-Host "Then run: tailscale funnel status"
Write-Host "Health check (does not expose credentials): http://127.0.0.1:8080/health"
Write-Host ""
node server.js
