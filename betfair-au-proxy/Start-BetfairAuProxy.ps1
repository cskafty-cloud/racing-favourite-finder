$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# Credentials are stored only as Windows DPAPI ciphertext, bound to this
# Windows user account on this PC. They are never written in plaintext.
# Keep credentials outside the extracted repository so they survive ZIP updates,
# folder renames and fresh downloads. DPAPI binds the ciphertext to this Windows
# user on this PC; it is never portable to another Windows profile or computer.
$CredentialDirectory = Join-Path $env:LOCALAPPDATA "RacingFavouriteFinder\\BetfairAdapter"
$CredentialFile = Join-Path $CredentialDirectory "credentials.dpapi"
$LegacyCredentialFile = Join-Path $PSScriptRoot ".betfair-credentials.dpapi"

if (-not (Test-Path -LiteralPath $CredentialDirectory)) {
  New-Item -ItemType Directory -Path $CredentialDirectory -Force | Out-Null
}
# One-time migration of the existing encrypted file from the old repo-local
# location. Move only the encrypted DPAPI payload; never decrypt/rewrite it here.
if (-not (Test-Path -LiteralPath $CredentialFile) -and (Test-Path -LiteralPath $LegacyCredentialFile)) {
  Move-Item -LiteralPath $LegacyCredentialFile -Destination $CredentialFile
}

function Read-SecretSecure([string]$Prompt) {
  return (Read-Host $Prompt -AsSecureString)
}
function Convert-SecureToPlain([Security.SecureString]$Secure) {
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
function Save-EncryptedCredentials([hashtable]$Values) {
  $encrypted = [ordered]@{}
  foreach ($name in @("BETFAIR_APP_KEY","BETFAIR_SESSION_TOKEN","BETFAIR_FEED_TOKEN")) {
    $secure = ConvertTo-SecureString -String ([string]$Values[$name]) -AsPlainText -Force
    $encrypted[$name] = ConvertFrom-SecureString -SecureString $secure
  }
  $json = $encrypted | ConvertTo-Json
  $temporary = $CredentialFile + ".tmp"
  [System.IO.File]::WriteAllText($temporary,$json,[System.Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $temporary -Destination $CredentialFile -Force
}
function Load-EncryptedCredentials {
  if (-not (Test-Path -LiteralPath $CredentialFile)) { return $null }
  try {
    $saved = Get-Content -LiteralPath $CredentialFile -Raw | ConvertFrom-Json
    $values = @{}
    foreach ($name in @("BETFAIR_APP_KEY","BETFAIR_SESSION_TOKEN","BETFAIR_FEED_TOKEN")) {
      if (-not $saved.$name) { throw "Missing encrypted field $name" }
      $secure = ConvertTo-SecureString -String ([string]$saved.$name)
      $values[$name] = Convert-SecureToPlain $secure
    }
    return $values
  } catch {
    throw "Could not decrypt the local Betfair configuration. It is protected for the Windows account that created it. Run this launcher under that same Windows account, or remove the encrypted file and re-enter the credentials. Details: $($_.Exception.Message)"
  }
}
function Read-NewCredentials {
  Write-Host ""
  Write-Host "Enter the three separate values. The third must match Railway exactly." -ForegroundColor Cyan
  $values = @{
    BETFAIR_APP_KEY = Convert-SecureToPlain (Read-SecretSecure "1/3 - Betfair app key (BETFAIR_APP_KEY)")
    BETFAIR_SESSION_TOKEN = Convert-SecureToPlain (Read-SecretSecure "2/3 - Betfair session token (BETFAIR_SESSION_TOKEN)")
    BETFAIR_FEED_TOKEN = (Convert-SecureToPlain (Read-SecretSecure "3/3 - Existing Railway shared token (BETFAIR_FEED_TOKEN)")).Trim()
  }
  foreach ($name in @("BETFAIR_APP_KEY","BETFAIR_SESSION_TOKEN","BETFAIR_FEED_TOKEN")) {
    if ([string]::IsNullOrWhiteSpace($values[$name])) { throw "Missing required value: $name. No service was started." }
  }
  Save-EncryptedCredentials $values
  Write-Host "Saved credentials in an encrypted, Windows-user-bound local config file." -ForegroundColor Green
  return $values
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js 22 or newer is required. Install the LTS release from https://nodejs.org/ and reopen PowerShell."
}
$nodeVersion = (node -p "process.versions.node").Split('.')[0]
if ([int]$nodeVersion -lt 22) { throw "Node.js 22 or newer is required. Detected $(node --version)." }

Write-Host ""
Write-Host "BETFAIR AUSTRALIAN READ-ONLY ADAPTER" -ForegroundColor Cyan
Write-Host "Credentials are stored encrypted with Windows DPAPI, outside the repository."
Write-Host "Saved file: $CredentialFile" -ForegroundColor DarkGray
Write-Host "The encrypted file can be decrypted only by this Windows user on this PC."
Write-Host "Your Betfair session token may expire; replace it through this launcher if Betfair rejects it."
Write-Host ""

$values = $null
if (Test-Path -LiteralPath $CredentialFile) {
  $choice = Read-Host "Use the saved encrypted credentials? [Y]es / [N]o, replace"
  if ($choice -match '^(n|no)$') {
    $values = Read-NewCredentials
  } else {
    $values = Load-EncryptedCredentials
    Write-Host "Loaded the saved encrypted configuration (secret values hidden)." -ForegroundColor Green
  }
} else {
  Write-Host "No encrypted local config exists yet. Enter the credentials once to save them."
  $values = Read-NewCredentials
}

$env:BETFAIR_APP_KEY = [string]$values.BETFAIR_APP_KEY
$env:BETFAIR_SESSION_TOKEN = [string]$values.BETFAIR_SESSION_TOKEN
$env:BETFAIR_FEED_TOKEN = ([string]$values.BETFAIR_FEED_TOKEN).Trim()
$env:PORT = "8080"
$values = $null

if ($env:BETFAIR_FEED_TOKEN -notmatch '^[a-fA-F0-9]{64}$') {
  Write-Warning "The shared token is not 64 hexadecimal characters. It can still work if it exactly matches Railway; no token has been changed."
}

Write-Host "Configuration loaded into this PowerShell process (secret values hidden)." -ForegroundColor Green
Write-Host "Starting Tailscale Funnel with the installed executable (avoids the blocked tailscale.ps1 shim)..."
$tailscaleExe = $null
$tailscaleCommand = Get-Command tailscale.exe -ErrorAction SilentlyContinue
if ($tailscaleCommand) { $tailscaleExe = $tailscaleCommand.Source }
if (-not $tailscaleExe) {
  $programFilesTailscale = Join-Path $env:ProgramFiles "Tailscale\tailscale.exe"
  if (Test-Path -LiteralPath $programFilesTailscale) { $tailscaleExe = $programFilesTailscale }
}
if ($tailscaleExe) {
  & $tailscaleExe funnel --bg 8080
  if ($LASTEXITCODE -eq 0) {
    & $tailscaleExe funnel status
  } else {
    Write-Warning "Tailscale Funnel did not start. In another PowerShell window, run: & \"$env:ProgramFiles\Tailscale\tailscale.exe\" funnel --bg 8080"
  }
} else {
  Write-Warning "tailscale.exe was not found. Install/sign in to Tailscale, then run: & \"$env:ProgramFiles\Tailscale\tailscale.exe\" funnel --bg 8080"
}
Write-Host ""
Write-Host "Starting local adapter on 127.0.0.1:8080. Keep this window open."
Write-Host "Health check: http://127.0.0.1:8080/health"
Write-Host "Protected routes: /api/races and /api/sports"
Write-Host "Credential file: $CredentialFile (encrypted; do not upload or share)"
Write-Host ""
node server.js
