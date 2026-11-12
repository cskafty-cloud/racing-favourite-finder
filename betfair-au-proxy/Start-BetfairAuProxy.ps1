$ErrorActionPreference = "Stop"
$RffLauncherVersion = "2026-11-13.7"
Set-Location $PSScriptRoot

# Local credentials are encrypted with Windows DPAPI and bound to this user.
$CredentialDirectory = Join-Path $env:LOCALAPPDATA "RacingFavouriteFinder\BetfairAdapter"
$CredentialFile = Join-Path $CredentialDirectory "credentials.dpapi"
$LegacyCredentialFile = Join-Path $PSScriptRoot ".betfair-credentials.dpapi"

if (-not (Test-Path -LiteralPath $CredentialDirectory)) {
  New-Item -ItemType Directory -Path $CredentialDirectory -Force | Out-Null
}
if (-not (Test-Path -LiteralPath $CredentialFile) -and (Test-Path -LiteralPath $LegacyCredentialFile)) {
  Move-Item -LiteralPath $LegacyCredentialFile -Destination $CredentialFile
}

function Read-SecretPlain([string]$Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
}

function Get-ClipboardFeedToken {
  try {
    $candidate = ([string](Get-Clipboard -Raw -ErrorAction Stop)).Trim()
  } catch {
    $candidate = ""
  }
  if ($candidate -cmatch '^[A-Fa-f0-9]{64}$') {
    return $candidate
  }
  return $null
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
      $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
      try {
        $values[$name] = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
      } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
      }
    }
    if ([string]$values.BETFAIR_FEED_TOKEN -cnotmatch '^[A-Fa-f0-9]{64}$') {
      throw "Saved shared token is not valid."
    }
    return $values
  } catch {
    throw "Could not decrypt or validate the saved credentials under this Windows account. Details: $($_.Exception.Message)"
  }
}

function Read-NewCredentials {
  Write-Host ""
  Write-Host "Enter your Betfair app key and session token. Values are hidden." -ForegroundColor Cyan
  $values = @{
    BETFAIR_APP_KEY = Read-SecretPlain "Betfair app key (BETFAIR_APP_KEY)"
    BETFAIR_SESSION_TOKEN = Read-SecretPlain "Betfair session token (BETFAIR_SESSION_TOKEN)"
    BETFAIR_FEED_TOKEN = ""
  }

  $feedToken = Get-ClipboardFeedToken
  if (-not $feedToken) {
    throw "Clipboard must contain only the 64-character hexadecimal Railway shared token. Generate/copy the token itself, not the PowerShell command or output. No credentials were saved and the adapter was not started."
  }
  $values.BETFAIR_FEED_TOKEN = $feedToken

  foreach ($name in @("BETFAIR_APP_KEY", "BETFAIR_SESSION_TOKEN")) {
    if ([string]::IsNullOrWhiteSpace([string]$values[$name])) {
      throw "Missing $name. No credentials were saved and the adapter was not started."
    }
  }
  Save-EncryptedCredentials $values
  Write-Host "Credentials saved locally using Windows DPAPI encryption." -ForegroundColor Green
  return $values
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js 22 or newer is required. Install the LTS release from https://nodejs.org/ and reopen PowerShell."
}
$nodeMajor = [int]((node -p "process.versions.node").Split('.')[0])
if ($nodeMajor -lt 22) {
  throw "Node.js 22 or newer is required. Detected $(node --version)."
}

Write-Host ""
Write-Host "BETFAIR AUSTRALIAN READ-ONLY ADAPTER | Launcher $RffLauncherVersion" -ForegroundColor Cyan
Write-Host "Credential file: $CredentialFile" -ForegroundColor DarkGray
Write-Host "Credentials are encrypted for this Windows user and this PC."
Write-Host "The Railway shared token is separate from your Betfair app key/session."
Write-Host ""

$values = $null

# When launched through "railway run", Railway injects the production variables
# into this process. Import them into this Windows user's DPAPI store so future
# starts can use the encrypted local file without needing Railway CLI each time.
$railwayNames = @("BETFAIR_APP_KEY", "BETFAIR_SESSION_TOKEN", "BETFAIR_FEED_TOKEN")
$railwayPresent = @($railwayNames | Where-Object {
  -not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_, "Process"))
})
if ($railwayPresent.Count -gt 0) {
  if ($railwayPresent.Count -ne $railwayNames.Count) {
    throw "Railway supplied only some Betfair variables. Ensure BETFAIR_APP_KEY, BETFAIR_SESSION_TOKEN and BETFAIR_FEED_TOKEN are all set in Railway Production. No credentials were saved."
  }
  $values = @{
    BETFAIR_APP_KEY = [Environment]::GetEnvironmentVariable("BETFAIR_APP_KEY", "Process")
    BETFAIR_SESSION_TOKEN = [Environment]::GetEnvironmentVariable("BETFAIR_SESSION_TOKEN", "Process")
    BETFAIR_FEED_TOKEN = [Environment]::GetEnvironmentVariable("BETFAIR_FEED_TOKEN", "Process")
  }
  if ([string]::IsNullOrWhiteSpace($values.BETFAIR_APP_KEY) -or
      [string]::IsNullOrWhiteSpace($values.BETFAIR_SESSION_TOKEN) -or
      $values.BETFAIR_FEED_TOKEN -cnotmatch '^[A-Fa-f0-9]{64}
  $choice = Read-Host "Use saved encrypted Betfair credentials? [Y]es / [N]o, replace"
  if ($choice -match '^(n|no)$') {
    $values = Read-NewCredentials
  } else {
    $values = Load-EncryptedCredentials
    Write-Host "Loaded saved encrypted Betfair credentials." -ForegroundColor Green

    # If clipboard contains a new valid feed token, rotate only that field.
    $newFeedToken = Get-ClipboardFeedToken
    if ($newFeedToken -and $newFeedToken -cne [string]$values.BETFAIR_FEED_TOKEN) {
      $values.BETFAIR_FEED_TOKEN = $newFeedToken
      Save-EncryptedCredentials $values
      Write-Host "Updated the encrypted Railway shared token; retained the saved Betfair login." -ForegroundColor Green
    }
  }
} else {
  Write-Host "No saved credential file found. Enter credentials once to create it."
  $values = Read-NewCredentials
}

$env:BETFAIR_APP_KEY = [string]$values.BETFAIR_APP_KEY
$env:BETFAIR_SESSION_TOKEN = [string]$values.BETFAIR_SESSION_TOKEN
$env:BETFAIR_FEED_TOKEN = [string]$values.BETFAIR_FEED_TOKEN
$env:PORT = "8080"
$values = $null

if ($env:BETFAIR_FEED_TOKEN -cnotmatch '^[A-Fa-f0-9]{64}$') {
  throw "The shared token is invalid. Adapter was not started."
}

Write-Host "Credentials loaded into this process; secret values remain hidden." -ForegroundColor Green

$tailscaleExe = $null
$tailscaleCommand = Get-Command tailscale.exe -ErrorAction SilentlyContinue
if ($tailscaleCommand) { $tailscaleExe = $tailscaleCommand.Source }
if (-not $tailscaleExe) {
  $candidate = Join-Path $env:ProgramFiles "Tailscale\tailscale.exe"
  if (Test-Path -LiteralPath $candidate) { $tailscaleExe = $candidate }
}

if ($tailscaleExe) {
  Write-Host "Starting Tailscale Funnel..."
  & $tailscaleExe funnel --bg 8080
  if ($LASTEXITCODE -eq 0) {
    & $tailscaleExe funnel status
  } else {
    Write-Warning "Tailscale Funnel did not start. Adapter will still start locally."
  }
} else {
  Write-Warning "tailscale.exe not found. Adapter will start locally without Funnel."
}

Write-Host ""
Write-Host "Starting adapter. Keep this PowerShell window open."
Write-Host "Health: http://127.0.0.1:8080/health"
Write-Host "Protected endpoints: /api/races and /api/sports"
Write-Host "Saved credential file is encrypted; never upload or share it."
Write-Host ""
node server.js
) {
    throw "Railway Betfair variables are incomplete or the shared token is not 64 hexadecimal characters. No credentials were saved."
  }
  Save-EncryptedCredentials $values
  Write-Host "Imported Railway Production Betfair variables and saved them encrypted with Windows DPAPI." -ForegroundColor Green
}

if ($values) {
  # Railway variables were imported above and persisted to DPAPI.
} elseif (Test-Path -LiteralPath $CredentialFile) {
  $choice = Read-Host "Use saved encrypted Betfair credentials? [Y]es / [N]o, replace"
  if ($choice -match '^(n|no)

$env:BETFAIR_APP_KEY = [string]$values.BETFAIR_APP_KEY
$env:BETFAIR_SESSION_TOKEN = [string]$values.BETFAIR_SESSION_TOKEN
$env:BETFAIR_FEED_TOKEN = [string]$values.BETFAIR_FEED_TOKEN
$env:PORT = "8080"
$values = $null

if ($env:BETFAIR_FEED_TOKEN -cnotmatch '^[A-Fa-f0-9]{64}$') {
  throw "The shared token is invalid. Adapter was not started."
}

Write-Host "Credentials loaded into this process; secret values remain hidden." -ForegroundColor Green

$tailscaleExe = $null
$tailscaleCommand = Get-Command tailscale.exe -ErrorAction SilentlyContinue
if ($tailscaleCommand) { $tailscaleExe = $tailscaleCommand.Source }
if (-not $tailscaleExe) {
  $candidate = Join-Path $env:ProgramFiles "Tailscale\tailscale.exe"
  if (Test-Path -LiteralPath $candidate) { $tailscaleExe = $candidate }
}

if ($tailscaleExe) {
  Write-Host "Starting Tailscale Funnel..."
  & $tailscaleExe funnel --bg 8080
  if ($LASTEXITCODE -eq 0) {
    & $tailscaleExe funnel status
  } else {
    Write-Warning "Tailscale Funnel did not start. Adapter will still start locally."
  }
} else {
  Write-Warning "tailscale.exe not found. Adapter will start locally without Funnel."
}

Write-Host ""
Write-Host "Starting adapter. Keep this PowerShell window open."
Write-Host "Health: http://127.0.0.1:8080/health"
Write-Host "Protected endpoints: /api/races and /api/sports"
Write-Host "Saved credential file is encrypted; never upload or share it."
Write-Host ""
node server.js
) {
    $values = Read-NewCredentials
  } else {
    $values = Load-EncryptedCredentials
    Write-Host "Loaded saved encrypted Betfair credentials." -ForegroundColor Green

    # If clipboard contains a new valid feed token, rotate only that field.
    $newFeedToken = Get-ClipboardFeedToken
    if ($newFeedToken -and $newFeedToken -cne [string]$values.BETFAIR_FEED_TOKEN) {
      $values.BETFAIR_FEED_TOKEN = $newFeedToken
      Save-EncryptedCredentials $values
      Write-Host "Updated the encrypted Railway shared token; retained the saved Betfair login." -ForegroundColor Green
    }
  }
} else {
  Write-Host "No saved credential file found. Enter credentials once to create it."
  $values = Read-NewCredentials
}

$env:BETFAIR_APP_KEY = [string]$values.BETFAIR_APP_KEY
$env:BETFAIR_SESSION_TOKEN = [string]$values.BETFAIR_SESSION_TOKEN
$env:BETFAIR_FEED_TOKEN = [string]$values.BETFAIR_FEED_TOKEN
$env:PORT = "8080"
$values = $null

if ($env:BETFAIR_FEED_TOKEN -cnotmatch '^[A-Fa-f0-9]{64}$') {
  throw "The shared token is invalid. Adapter was not started."
}

Write-Host "Credentials loaded into this process; secret values remain hidden." -ForegroundColor Green

$tailscaleExe = $null
$tailscaleCommand = Get-Command tailscale.exe -ErrorAction SilentlyContinue
if ($tailscaleCommand) { $tailscaleExe = $tailscaleCommand.Source }
if (-not $tailscaleExe) {
  $candidate = Join-Path $env:ProgramFiles "Tailscale\tailscale.exe"
  if (Test-Path -LiteralPath $candidate) { $tailscaleExe = $candidate }
}

if ($tailscaleExe) {
  Write-Host "Starting Tailscale Funnel..."
  & $tailscaleExe funnel --bg 8080
  if ($LASTEXITCODE -eq 0) {
    & $tailscaleExe funnel status
  } else {
    Write-Warning "Tailscale Funnel did not start. Adapter will still start locally."
  }
} else {
  Write-Warning "tailscale.exe not found. Adapter will start locally without Funnel."
}

Write-Host ""
Write-Host "Starting adapter. Keep this PowerShell window open."
Write-Host "Health: http://127.0.0.1:8080/health"
Write-Host "Protected endpoints: /api/races and /api/sports"
Write-Host "Saved credential file is encrypted; never upload or share it."
Write-Host ""
node server.js
