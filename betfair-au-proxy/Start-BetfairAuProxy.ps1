$ErrorActionPreference = "Stop"
$RffLauncherVersion = "2026-11-13.4"
Set-Location $PSScriptRoot

# Credentials are stored only as Windows DPAPI ciphertext, bound to this
# Windows user account on this PC. They are never written in plaintext.
$CredentialDirectory = Join-Path $env:LOCALAPPDATA "RacingFavouriteFinder\BetfairAdapter"
$CredentialFile = Join-Path $CredentialDirectory "credentials.dpapi"
$LegacyCredentialFile = Join-Path $PSScriptRoot ".betfair-credentials.dpapi"

if (-not (Test-Path -LiteralPath $CredentialDirectory)) {
  New-Item -ItemType Directory -Path $CredentialDirectory -Force | Out-Null
}
# Migrate only the encrypted payload from the former repository-local path.
if (-not (Test-Path -LiteralPath $CredentialFile) -and (Test-Path -LiteralPath $LegacyCredentialFile)) {
  Move-Item -LiteralPath $LegacyCredentialFile -Destination $CredentialFile
}

function Read-SecretSecure([string]$Prompt) {
  Read-Host $Prompt -AsSecureString
}

function Convert-SecureToPlain([Security.SecureString]$Secure) {
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try {
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
}

function Save-EncryptedCredentials([hashtable]$Values) {
  $encrypted = [ordered]@{}
  foreach ($name in @("BETFAIR_APP_KEY", "BETFAIR_SESSION_TOKEN", "BETFAIR_FEED_TOKEN")) {
    $secure = ConvertTo-SecureString -String ([string]$Values[$name]) -AsPlainText -Force
    $encrypted[$name] = ConvertFrom-SecureString -SecureString $secure
  }
  $json = $encrypted | ConvertTo-Json
  $temporary = $CredentialFile + ".tmp"
  [System.IO.File]::WriteAllText($temporary, $json, [System.Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $temporary -Destination $CredentialFile -Force
}

function Load-EncryptedCredentials {
  if (-not (Test-Path -LiteralPath $CredentialFile)) { return $null }
  try {
    $saved = Get-Content -LiteralPath $CredentialFile -Raw | ConvertFrom-Json
    $values = @{}
    foreach ($name in @("BETFAIR_APP_KEY", "BETFAIR_SESSION_TOKEN", "BETFAIR_FEED_TOKEN")) {
      if (-not $saved.$name) { throw "Missing encrypted field $name" }
      $secure = ConvertTo-SecureString -String ([string]$saved.$name)
      $values[$name] = Convert-SecureToPlain $secure
    }
    if ([string]$values.BETFAIR_FEED_TOKEN -notmatch '^[a-fA-F0-9]{64}$') {
      throw "The saved BETFAIR_FEED_TOKEN is not exactly 64 hexadecimal characters."
    }
    return $values
  } catch {
    throw "Could not load valid local Betfair credentials. Run this launcher under the same Windows account that saved them. If the shared token is invalid, choose N to replace it. Details: $($_.Exception.Message)"
  }
}

function Read-NewCredentials {
  Write-Host ""
  Write-Host "Enter the three separate values. The third must match Railway exactly." -ForegroundColor Cyan
  $values = @{
    BETFAIR_APP_KEY = Convert-SecureToPlain (Read-SecretSecure "1/3 - Betfair app key (BETFAIR_APP_KEY)")
    BETFAIR_SESSION_TOKEN = Convert-SecureToPlain (Read-SecretSecure "2/3 - Betfair session token (BETFAIR_SESSION_TOKEN)")
    BETFAIR_FEED_TOKEN = ""
  }

  # Prefer reading the shared token directly from the clipboard. This avoids
  # masked Read-Host paste issues and never displays the token in the console.
  $clipboardToken = ""
  try {
    $clipboardToken = [string](Get-Clipboard -Raw -ErrorAction Stop)
    $clipboardToken = $clipboardToken.Trim()
  } catch {
    $clipboardToken = ""
  }

  if ($clipboardToken -match '^[a-fA-F0-9]{64}
  foreach ($name in @("BETFAIR_APP_KEY", "BETFAIR_SESSION_TOKEN", "BETFAIR_FEED_TOKEN")) {
    if ([string]::IsNullOrWhiteSpace($values[$name])) {
      throw "Missing required value: $name. No service was started and no credentials were saved."
    }
  }
  if ($values.BETFAIR_FEED_TOKEN -notmatch '^[a-fA-F0-9]{64}$') {
    throw "BETFAIR_FEED_TOKEN must be exactly 64 hexadecimal characters. Generate a fresh 32-byte token locally, set the same value in Railway production, then rerun and choose N. No adapter was started and no new credentials were saved."
  }
  Save-EncryptedCredentials $values
  Write-Host "Saved credentials in an encrypted, Windows-user-bound local config file." -ForegroundColor Green
  return $values
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js 22 or newer is required. Install the LTS release from https://nodejs.org/ and reopen PowerShell."
}
$nodeVersion = (node -p "process.versions.node").Split('.')[0]
if ([int]$nodeVersion -lt 22) {
  throw "Node.js 22 or newer is required. Detected $(node --version)."
}

Write-Host ""
Write-Host "BETFAIR AUSTRALIAN READ-ONLY ADAPTER  |  Launcher $RffLauncherVersion" -ForegroundColor Cyan
Write-Host "Credentials are stored encrypted with Windows DPAPI, outside the repository."
Write-Host "Saved file: $CredentialFile" -ForegroundColor DarkGray
Write-Host "The encrypted file can be decrypted only by this Windows user on this PC."
Write-Host "Your Betfair session token may expire; replace it through this launcher only if Betfair rejects it."
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
  throw "The shared feed token is invalid. No adapter was started."
}

Write-Host "Configuration loaded into this PowerShell process (secret values hidden)." -ForegroundColor Green
Write-Host "Starting Tailscale Funnel with the installed executable..."
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
    Write-Warning ("Tailscale Funnel did not start. In another PowerShell window, run: & `"{0}`" funnel --bg 8080" -f $tailscaleExe)
  }
} else {
  Write-Warning "tailscale.exe was not found. Install Tailscale, sign in, then rerun this launcher."
}

Write-Host ""
Write-Host "Starting local adapter on 127.0.0.1:8080. Keep this window open."
Write-Host "Health check: http://127.0.0.1:8080/health"
Write-Host "Protected routes: /api/races and /api/sports"
Write-Host "Credential file: $CredentialFile (encrypted; do not upload or share)"
Write-Host ""
node server.js
) {
    $values.BETFAIR_FEED_TOKEN = $clipboardToken
    Write-Host "Loaded a valid 64-character shared token from clipboard (value hidden)." -ForegroundColor Green
  } else {
    $clipboardLength = $clipboardToken.Length
    throw "Clipboard does not contain exactly a 64-character hexadecimal BETFAIR_FEED_TOKEN (detected length: $clipboardLength). Generate a fresh token, copy only that token, set the same value in Railway production, and rerun. No adapter was started and no new credentials were saved."
  }
  foreach ($name in @("BETFAIR_APP_KEY", "BETFAIR_SESSION_TOKEN", "BETFAIR_FEED_TOKEN")) {
    if ([string]::IsNullOrWhiteSpace($values[$name])) {
      throw "Missing required value: $name. No service was started and no credentials were saved."
    }
  }
  if ($values.BETFAIR_FEED_TOKEN -notmatch '^[a-fA-F0-9]{64}$') {
    throw "BETFAIR_FEED_TOKEN must be exactly 64 hexadecimal characters. Generate a fresh 32-byte token locally, set the same value in Railway production, then rerun and choose N. No adapter was started and no new credentials were saved."
  }
  Save-EncryptedCredentials $values
  Write-Host "Saved credentials in an encrypted, Windows-user-bound local config file." -ForegroundColor Green
  return $values
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js 22 or newer is required. Install the LTS release from https://nodejs.org/ and reopen PowerShell."
}
$nodeVersion = (node -p "process.versions.node").Split('.')[0]
if ([int]$nodeVersion -lt 22) {
  throw "Node.js 22 or newer is required. Detected $(node --version)."
}

Write-Host ""
Write-Host "BETFAIR AUSTRALIAN READ-ONLY ADAPTER  |  Launcher $RffLauncherVersion" -ForegroundColor Cyan
Write-Host "Credentials are stored encrypted with Windows DPAPI, outside the repository."
Write-Host "Saved file: $CredentialFile" -ForegroundColor DarkGray
Write-Host "The encrypted file can be decrypted only by this Windows user on this PC."
Write-Host "Your Betfair session token may expire; replace it through this launcher only if Betfair rejects it."
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
  throw "The shared feed token is invalid. No adapter was started."
}

Write-Host "Configuration loaded into this PowerShell process (secret values hidden)." -ForegroundColor Green
Write-Host "Starting Tailscale Funnel with the installed executable..."
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
    Write-Warning ("Tailscale Funnel did not start. In another PowerShell window, run: & `"{0}`" funnel --bg 8080" -f $tailscaleExe)
  }
} else {
  Write-Warning "tailscale.exe was not found. Install Tailscale, sign in, then rerun this launcher."
}

Write-Host ""
Write-Host "Starting local adapter on 127.0.0.1:8080. Keep this window open."
Write-Host "Health check: http://127.0.0.1:8080/health"
Write-Host "Protected routes: /api/races and /api/sports"
Write-Host "Credential file: $CredentialFile (encrypted; do not upload or share)"
Write-Host ""
node server.js
