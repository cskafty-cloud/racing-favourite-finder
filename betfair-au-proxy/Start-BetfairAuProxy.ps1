$ErrorActionPreference = "Stop"
$RffLauncherVersion = "2026-11-13.23"
Set-Location $PSScriptRoot

Write-Host "Betfair AU adapter launcher version $RffLauncherVersion" -ForegroundColor Cyan

# Keep the local read-only adapter in sync with the tested GitHub source.
# Download the entry point and race-type helper; token validation is inline so no third file is required.
# The encrypted DPAPI credential file is separate and is never downloaded or overwritten.
$AdapterServerPath = Join-Path $PSScriptRoot "server.js"
$AdapterCategoryPath = Join-Path $PSScriptRoot "race-category.js"
$AdapterUpdateBase = "https://raw.githubusercontent.com/cskafty-cloud/racing-favourite-finder/main/betfair-au-proxy"
$AdapterServerTemp = Join-Path $env:TEMP ("RFF-BetfairAuProxy-server-" + $PID + ".js")
$AdapterCategoryTemp = Join-Path $env:TEMP ("RFF-BetfairAuProxy-category-" + $PID + ".js")
try {
  Invoke-WebRequest -Uri ($AdapterUpdateBase + "/server.js") -OutFile $AdapterServerTemp -TimeoutSec 20
  Invoke-WebRequest -Uri ($AdapterUpdateBase + "/race-category.js") -OutFile $AdapterCategoryTemp -TimeoutSec 20
  $AdapterCandidate = Get-Content -LiteralPath $AdapterServerTemp -Raw
  $CategoryCandidate = Get-Content -LiteralPath $AdapterCategoryTemp -Raw
  if ($AdapterCandidate.Length -lt 5000 -or
      -not $AdapterCandidate.Contains("accessTokenMatches") -or
      -not $AdapterCandidate.Contains('require("./race-category")') -or
      -not $AdapterCandidate.Contains("BETFAIR_AU_RACING_EVENT_TYPES") -or
      $AdapterCandidate.Contains('require("./token-auth")')) {
    throw "Downloaded adapter entry point did not pass the expected source checks."
  }
  if ($CategoryCandidate.Length -lt 300 -or
      -not $CategoryCandidate.Contains("function raceCategory") -or
      -not $CategoryCandidate.Contains("module.exports")) {
    throw "Downloaded race-category helper did not pass the expected source checks."
  }
  if (Test-Path -LiteralPath $AdapterServerPath) {
    Copy-Item -LiteralPath $AdapterServerPath -Destination ($AdapterServerPath + ".previous") -Force
  }
  & node --check $AdapterServerTemp
  if ($LASTEXITCODE -ne 0) { throw "Downloaded adapter server.js failed Node syntax validation." }
  & node --check $AdapterCategoryTemp
  if ($LASTEXITCODE -ne 0) { throw "Downloaded race-category.js failed Node syntax validation." }
  if (Test-Path -LiteralPath $AdapterCategoryPath) {
    Copy-Item -LiteralPath $AdapterCategoryPath -Destination ($AdapterCategoryPath + ".previous") -Force
  }
  Move-Item -LiteralPath $AdapterCategoryTemp -Destination $AdapterCategoryPath -Force
  Move-Item -LiteralPath $AdapterServerTemp -Destination $AdapterServerPath -Force
  Write-Host "Updated the self-contained adapter entry point and race-type helper from GitHub; Node syntax checks passed." -ForegroundColor Green
} catch {
  throw ("Adapter source update/validation failed; refusing to start a possibly broken local proxy. " + $_.Exception.Message)
} finally {
  foreach ($temporaryPath in @($AdapterServerTemp, $AdapterCategoryTemp)) {
    if (Test-Path -LiteralPath $temporaryPath) {
      Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
    }
  }
}
# Local credentials are encrypted with Windows DPAPI and bound to this user and PC.
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

function Get-NewBetfairSessionToken([string]$AppKey) {
  $username = Read-Host "Betfair username"
  $securePassword = Read-Host "Betfair password (hidden)" -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  $password = $null
  try {
    $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
  $twoFactor = Read-Host "Betfair one-time 2FA code (leave blank if not required)"
  if (-not [string]::IsNullOrWhiteSpace($twoFactor)) { $password += $twoFactor }
  try {
    $body = "username=$([System.Uri]::EscapeDataString($username))&password=$([System.Uri]::EscapeDataString($password))"
    $response = Invoke-RestMethod -Method Post -Uri "https://identitysso.betfair.com.au/api/login" -Headers @{ "X-Application" = $AppKey; "Accept" = "application/json" } -ContentType "application/x-www-form-urlencoded" -Body $body -TimeoutSec 30
    if ($response.status -notin @("SUCCESS", "LIMITED_ACCESS") -or [string]::IsNullOrWhiteSpace([string]$response.token)) {
      $reason = if ($response.error) { [string]$response.error } else { [string]$response.status }
      throw "Betfair login was not successful ($reason). Check the account login, 2FA code and any pending Betfair website terms/security prompts."
    }
    return [string]$response.token
  } catch {
    if ($_.Exception.Message -like "Betfair login was not successful*") { throw }
    throw "Could not complete the official Betfair Australia API login. Check network access and account requirements; no password or token was displayed. $($_.Exception.Message)"
  } finally {
    $password = $null
    $twoFactor = $null
    $body = $null
  }
}
function Offer-CopySessionToken([string]$SessionToken) {
  $choice = Read-Host "Copy the new session token to the Windows clipboard so you can paste it into Railway Production? [y/N]"
  if ($choice -match "^(y|yes)$") {
    try {
      Set-Clipboard -Value $SessionToken -ErrorAction Stop
      Write-Host "Session token copied to clipboard. Paste it only into Railway Production BETFAIR_SESSION_TOKEN; do not send it in chat." -ForegroundColor Yellow
    } catch {
      Write-Warning "Could not access the clipboard. The new session is saved locally; update Railway BETFAIR_SESSION_TOKEN using a secure method."
    }
  }
}
function Offer-CopyFeedToken([string]$FeedToken) {
  $choice = Read-Host "Copy the saved shared feed token to the Windows clipboard so you can restore Railway BETFAIR_FEED_TOKEN? [y/N]"
  if ($choice -match "^(y|yes)$") {
    try {
      Set-Clipboard -Value $FeedToken -ErrorAction Stop
      Write-Host "Saved shared feed token copied to clipboard. Paste it only into Railway Production BETFAIR_FEED_TOKEN; do not send it in chat." -ForegroundColor Yellow
    } catch {
      Write-Warning "Could not access the clipboard. The encrypted saved token remains unchanged."
    }
  }
}
function Get-ClipboardFeedToken {
  try {
    $candidate = [string](Get-Clipboard -Raw -ErrorAction Stop)
  } catch {
    $candidate = ""
  }
  if ($candidate.Length -ge 16 -and $candidate.Length -le 512 -and $candidate -notmatch '\s') { return $candidate }
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
    if ([string]::IsNullOrWhiteSpace([string]$values.BETFAIR_FEED_TOKEN) -or [string]$values.BETFAIR_FEED_TOKEN -match '\s') {
      throw "Saved shared token is empty or contains whitespace."
    }
    return $values
  } catch {
    throw "Could not decrypt or validate saved credentials under this Windows account. Details: $($_.Exception.Message)"
  }
}

function Read-NewCredentials {
  Write-Host ""
  Write-Host "Enter your Betfair app key. The session will be generated through Betfair official Australian API login." -ForegroundColor Cyan
  $appKey = Read-SecretPlain "Betfair app key (BETFAIR_APP_KEY)"
  if ([string]::IsNullOrWhiteSpace($appKey)) { throw "Missing Betfair app key. No credentials were saved." }
  $values = @{
    BETFAIR_APP_KEY = $appKey
    BETFAIR_SESSION_TOKEN = Get-NewBetfairSessionToken $appKey
    BETFAIR_FEED_TOKEN = ""
  }
  $feedToken = Get-ClipboardFeedToken
  if (-not $feedToken) {
    throw "Clipboard must contain only the Railway shared feed token (16-512 characters, no whitespace). Copy the token itself, not a command or output. No credentials were saved."
  }
  $values.BETFAIR_FEED_TOKEN = $feedToken
  foreach ($name in @("BETFAIR_APP_KEY", "BETFAIR_SESSION_TOKEN")) {
    if ([string]::IsNullOrWhiteSpace([string]$values[$name])) {
      throw "Missing $name. No credentials were saved and the adapter was not started."
    }
  }
  Save-EncryptedCredentials $values
  Write-Host "Credentials saved locally using Windows DPAPI encryption." -ForegroundColor Green
  Offer-CopySessionToken ([string]$values.BETFAIR_SESSION_TOKEN)
  return $values
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js 22 or newer is required. Install the LTS release from https://nodejs.org/ and reopen PowerShell."
}
$nodeMajor = [int]((node -p "process.versions.node").Split('.')[0])
if ($nodeMajor -lt 22) { throw "Node.js 22 or newer is required. Detected $(node --version)." }

Write-Host ""
Write-Host "BETFAIR AUSTRALIAN READ-ONLY ADAPTER | Launcher $RffLauncherVersion" -ForegroundColor Cyan
Write-Host "Credential file: $CredentialFile" -ForegroundColor DarkGray
Write-Host "Credentials are encrypted for this Windows user and this PC."
Write-Host ""

$values = $null
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
  if ([string]::IsNullOrWhiteSpace([string]$values.BETFAIR_APP_KEY) -or
      [string]::IsNullOrWhiteSpace([string]$values.BETFAIR_SESSION_TOKEN) -or
      ([string]::IsNullOrWhiteSpace([string]$values.BETFAIR_FEED_TOKEN) -or [string]$values.BETFAIR_FEED_TOKEN -match '\s')) {
    throw "Railway Betfair variables are incomplete or the shared token is empty/contains whitespace. No credentials were saved."
  }
  Save-EncryptedCredentials $values
  Write-Host "Imported Railway Production Betfair variables and saved them encrypted with Windows DPAPI." -ForegroundColor Green
} elseif (Test-Path -LiteralPath $CredentialFile) {
  # Allow a fresh session to be entered without changing the separate shared feed token.
  $values = Load-EncryptedCredentials
  Write-Host "The saved Betfair session may have expired. To replace it, sign in through Betfair's official Australian API login now." -ForegroundColor Yellow
  $credentialChoice = Read-Host "Sign in again and replace the saved session token? [y/N]"
  if ($credentialChoice -match '^(y|yes)
    Write-Host "Sign in to Betfair through its official Australian API login. The saved shared feed token will be retained." -ForegroundColor Cyan
    $appKey = [string]$values.BETFAIR_APP_KEY
    $newSession = Get-NewBetfairSessionToken $appKey
    $values = @{
      BETFAIR_APP_KEY = $appKey
      BETFAIR_SESSION_TOKEN = $newSession
      BETFAIR_FEED_TOKEN = $savedFeedToken
    }
    if ([string]::IsNullOrWhiteSpace([string]$values.BETFAIR_APP_KEY) -or
        [string]::IsNullOrWhiteSpace([string]$values.BETFAIR_SESSION_TOKEN)) {
      throw "Missing Betfair app key or session token. Existing encrypted credentials were not replaced."
    }
    Save-EncryptedCredentials $values
    Write-Host "New Betfair credentials saved locally using Windows DPAPI; shared feed token retained." -ForegroundColor Green
    Offer-CopySessionToken ([string]$values.BETFAIR_SESSION_TOKEN)
  } else {
    Write-Host "Kept the saved encrypted Betfair credentials. If /health reports INVALID_SESSION_INFORMATION, rerun and answer Y to the sign-in prompt." -ForegroundColor Green
    $newFeedToken = Get-ClipboardFeedToken
    if ($newFeedToken -and $newFeedToken -cne [string]$values.BETFAIR_FEED_TOKEN) {
      $values.BETFAIR_FEED_TOKEN = $newFeedToken
      Save-EncryptedCredentials $values
      Write-Host "Updated the encrypted shared token; retained the saved Betfair login." -ForegroundColor Green
    }
  }
} else {
  Write-Host "No saved credential file found. Enter credentials once to create it."
  $values = Read-NewCredentials
}

Offer-CopyFeedToken ([string]$values.BETFAIR_FEED_TOKEN)

$env:BETFAIR_APP_KEY = [string]$values.BETFAIR_APP_KEY
$env:BETFAIR_SESSION_TOKEN = [string]$values.BETFAIR_SESSION_TOKEN
$env:BETFAIR_FEED_TOKEN = [string]$values.BETFAIR_FEED_TOKEN
$env:PORT = "8080"
$values = $null

if ([string]::IsNullOrWhiteSpace($env:BETFAIR_FEED_TOKEN) -or $env:BETFAIR_FEED_TOKEN -match '\s') {
  throw "The shared token is empty or contains whitespace. Adapter was not started."
}
Write-Host "Credentials loaded into this process; secret values remain hidden." -ForegroundColor Green

# Prevent duplicate Node adapters and safely replace only the known Betfair adapter.
$listener = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1
if ($listener) {
  $portOwnerPid = [int]$listener.OwningProcess
  $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $portOwnerPid" -ErrorAction SilentlyContinue
  Write-Warning "Port 8080 is already occupied by PID $portOwnerPid."
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8080/health" -TimeoutSec 4
    Write-Host "Existing service health endpoint responded." -ForegroundColor Yellow
  } catch {
    Write-Warning "The process on port 8080 did not return a usable adapter health response."
  }

  if (-not $owner) {
    throw "Cannot identify the process owning port 8080. Nothing was stopped; no second adapter was started."
  }

  Write-Host "Process: $($owner.Name) | PID: $portOwnerPid" -ForegroundColor DarkGray
  $isBetfairAdapter = $owner.Name -ieq "node.exe" -and
    $owner.CommandLine -match 'server\.js' -and
    $owner.CommandLine -match 'betfair-au-proxy'

  if (-not $isBetfairAdapter) {
    throw "Port 8080 belongs to a different application. It was left running; no second adapter was started."
  }

  Write-Host "Recognised existing Betfair adapter. Restarting it automatically to load the current encrypted credentials..." -ForegroundColor Cyan
  Stop-Process -Id $portOwnerPid -Force
  $deadline = (Get-Date).AddSeconds(10)
  do {
    Start-Sleep -Milliseconds 400
    $stillListening = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
  } while ($stillListening -and (Get-Date) -lt $deadline)

  if ($stillListening) {
    throw "Port 8080 is still occupied after stopping the identified adapter. No duplicate was started."
  }
  Write-Host "Port 8080 is free. Starting one fresh adapter instance." -ForegroundColor Green
}

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
    $savedFeedToken = [string]$values.BETFAIR_FEED_TOKEN
    Write-Host "Sign in to Betfair through its official Australian API login. The saved shared feed token will be retained." -ForegroundColor Cyan
    $appKey = [string]$values.BETFAIR_APP_KEY
    $newSession = Get-NewBetfairSessionToken $appKey
    $values = @{
      BETFAIR_APP_KEY = $appKey
      BETFAIR_SESSION_TOKEN = $newSession
      BETFAIR_FEED_TOKEN = $savedFeedToken
    }
    if ([string]::IsNullOrWhiteSpace([string]$values.BETFAIR_APP_KEY) -or
        [string]::IsNullOrWhiteSpace([string]$values.BETFAIR_SESSION_TOKEN)) {
      throw "Missing Betfair app key or session token. Existing encrypted credentials were not replaced."
    }
    Save-EncryptedCredentials $values
    Write-Host "New Betfair credentials saved locally using Windows DPAPI; shared feed token retained." -ForegroundColor Green
    Offer-CopySessionToken ([string]$values.BETFAIR_SESSION_TOKEN)
  } else {
    Write-Host "Automatically loaded saved encrypted Betfair credentials." -ForegroundColor Green
    $newFeedToken = Get-ClipboardFeedToken
    if ($newFeedToken -and $newFeedToken -cne [string]$values.BETFAIR_FEED_TOKEN) {
      $values.BETFAIR_FEED_TOKEN = $newFeedToken
      Save-EncryptedCredentials $values
      Write-Host "Updated the encrypted shared token; retained the saved Betfair login." -ForegroundColor Green
    }
  }
} else {
  Write-Host "No saved credential file found. Enter credentials once to create it."
  $values = Read-NewCredentials
}

Offer-CopyFeedToken ([string]$values.BETFAIR_FEED_TOKEN)

$env:BETFAIR_APP_KEY = [string]$values.BETFAIR_APP_KEY
$env:BETFAIR_SESSION_TOKEN = [string]$values.BETFAIR_SESSION_TOKEN
$env:BETFAIR_FEED_TOKEN = [string]$values.BETFAIR_FEED_TOKEN
$env:PORT = "8080"
$values = $null

if ([string]::IsNullOrWhiteSpace($env:BETFAIR_FEED_TOKEN) -or $env:BETFAIR_FEED_TOKEN -match '\s') {
  throw "The shared token is empty or contains whitespace. Adapter was not started."
}
Write-Host "Credentials loaded into this process; secret values remain hidden." -ForegroundColor Green

# Prevent duplicate Node adapters and safely replace only the known Betfair adapter.
$listener = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1
if ($listener) {
  $portOwnerPid = [int]$listener.OwningProcess
  $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $portOwnerPid" -ErrorAction SilentlyContinue
  Write-Warning "Port 8080 is already occupied by PID $portOwnerPid."
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8080/health" -TimeoutSec 4
    Write-Host "Existing service health endpoint responded." -ForegroundColor Yellow
  } catch {
    Write-Warning "The process on port 8080 did not return a usable adapter health response."
  }

  if (-not $owner) {
    throw "Cannot identify the process owning port 8080. Nothing was stopped; no second adapter was started."
  }

  Write-Host "Process: $($owner.Name) | PID: $portOwnerPid" -ForegroundColor DarkGray
  $isBetfairAdapter = $owner.Name -ieq "node.exe" -and
    $owner.CommandLine -match 'server\.js' -and
    $owner.CommandLine -match 'betfair-au-proxy'

  if (-not $isBetfairAdapter) {
    throw "Port 8080 belongs to a different application. It was left running; no second adapter was started."
  }

  Write-Host "Recognised existing Betfair adapter. Restarting it automatically to load the current encrypted credentials..." -ForegroundColor Cyan
  Stop-Process -Id $portOwnerPid -Force
  $deadline = (Get-Date).AddSeconds(10)
  do {
    Start-Sleep -Milliseconds 400
    $stillListening = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
  } while ($stillListening -and (Get-Date) -lt $deadline)

  if ($stillListening) {
    throw "Port 8080 is still occupied after stopping the identified adapter. No duplicate was started."
  }
  Write-Host "Port 8080 is free. Starting one fresh adapter instance." -ForegroundColor Green
}

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
    $savedFeedToken = [string]$values.BETFAIR_FEED_TOKEN
    Write-Host "Sign in to Betfair through its official Australian API login. The saved shared feed token will be retained." -ForegroundColor Cyan
    $appKey = [string]$values.BETFAIR_APP_KEY
    $newSession = Get-NewBetfairSessionToken $appKey
    $values = @{
      BETFAIR_APP_KEY = $appKey
      BETFAIR_SESSION_TOKEN = $newSession
      BETFAIR_FEED_TOKEN = $savedFeedToken
    }
    if ([string]::IsNullOrWhiteSpace([string]$values.BETFAIR_APP_KEY) -or
        [string]::IsNullOrWhiteSpace([string]$values.BETFAIR_SESSION_TOKEN)) {
      throw "Missing Betfair app key or session token. Existing encrypted credentials were not replaced."
    }
    Save-EncryptedCredentials $values
    Write-Host "New Betfair credentials saved locally using Windows DPAPI; shared feed token retained." -ForegroundColor Green
    Offer-CopySessionToken ([string]$values.BETFAIR_SESSION_TOKEN)
  } else {
    Write-Host "Kept the saved encrypted Betfair credentials. If /health reports INVALID_SESSION_INFORMATION, rerun and answer Y to the sign-in prompt." -ForegroundColor Green
    $newFeedToken = Get-ClipboardFeedToken
    if ($newFeedToken -and $newFeedToken -cne [string]$values.BETFAIR_FEED_TOKEN) {
      $values.BETFAIR_FEED_TOKEN = $newFeedToken
      Save-EncryptedCredentials $values
      Write-Host "Updated the encrypted shared token; retained the saved Betfair login." -ForegroundColor Green
    }
  }
} else {
  Write-Host "No saved credential file found. Enter credentials once to create it."
  $values = Read-NewCredentials
}

Offer-CopyFeedToken ([string]$values.BETFAIR_FEED_TOKEN)

$env:BETFAIR_APP_KEY = [string]$values.BETFAIR_APP_KEY
$env:BETFAIR_SESSION_TOKEN = [string]$values.BETFAIR_SESSION_TOKEN
$env:BETFAIR_FEED_TOKEN = [string]$values.BETFAIR_FEED_TOKEN
$env:PORT = "8080"
$values = $null

if ([string]::IsNullOrWhiteSpace($env:BETFAIR_FEED_TOKEN) -or $env:BETFAIR_FEED_TOKEN -match '\s') {
  throw "The shared token is empty or contains whitespace. Adapter was not started."
}
Write-Host "Credentials loaded into this process; secret values remain hidden." -ForegroundColor Green

# Prevent duplicate Node adapters and safely replace only the known Betfair adapter.
$listener = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1
if ($listener) {
  $portOwnerPid = [int]$listener.OwningProcess
  $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $portOwnerPid" -ErrorAction SilentlyContinue
  Write-Warning "Port 8080 is already occupied by PID $portOwnerPid."
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8080/health" -TimeoutSec 4
    Write-Host "Existing service health endpoint responded." -ForegroundColor Yellow
  } catch {
    Write-Warning "The process on port 8080 did not return a usable adapter health response."
  }

  if (-not $owner) {
    throw "Cannot identify the process owning port 8080. Nothing was stopped; no second adapter was started."
  }

  Write-Host "Process: $($owner.Name) | PID: $portOwnerPid" -ForegroundColor DarkGray
  $isBetfairAdapter = $owner.Name -ieq "node.exe" -and
    $owner.CommandLine -match 'server\.js' -and
    $owner.CommandLine -match 'betfair-au-proxy'

  if (-not $isBetfairAdapter) {
    throw "Port 8080 belongs to a different application. It was left running; no second adapter was started."
  }

  Write-Host "Recognised existing Betfair adapter. Restarting it automatically to load the current encrypted credentials..." -ForegroundColor Cyan
  Stop-Process -Id $portOwnerPid -Force
  $deadline = (Get-Date).AddSeconds(10)
  do {
    Start-Sleep -Milliseconds 400
    $stillListening = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
  } while ($stillListening -and (Get-Date) -lt $deadline)

  if ($stillListening) {
    throw "Port 8080 is still occupied after stopping the identified adapter. No duplicate was started."
  }
  Write-Host "Port 8080 is free. Starting one fresh adapter instance." -ForegroundColor Green
}

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
    $savedFeedToken = [string]$values.BETFAIR_FEED_TOKEN
    Write-Host "Sign in to Betfair through its official Australian API login. The saved shared feed token will be retained." -ForegroundColor Cyan
    $appKey = [string]$values.BETFAIR_APP_KEY
    $newSession = Get-NewBetfairSessionToken $appKey
    $values = @{
      BETFAIR_APP_KEY = $appKey
      BETFAIR_SESSION_TOKEN = $newSession
      BETFAIR_FEED_TOKEN = $savedFeedToken
    }
    if ([string]::IsNullOrWhiteSpace([string]$values.BETFAIR_APP_KEY) -or
        [string]::IsNullOrWhiteSpace([string]$values.BETFAIR_SESSION_TOKEN)) {
      throw "Missing Betfair app key or session token. Existing encrypted credentials were not replaced."
    }
    Save-EncryptedCredentials $values
    Write-Host "New Betfair credentials saved locally using Windows DPAPI; shared feed token retained." -ForegroundColor Green
    Offer-CopySessionToken ([string]$values.BETFAIR_SESSION_TOKEN)
  } else {
    Write-Host "Automatically loaded saved encrypted Betfair credentials." -ForegroundColor Green
    $newFeedToken = Get-ClipboardFeedToken
    if ($newFeedToken -and $newFeedToken -cne [string]$values.BETFAIR_FEED_TOKEN) {
      $values.BETFAIR_FEED_TOKEN = $newFeedToken
      Save-EncryptedCredentials $values
      Write-Host "Updated the encrypted shared token; retained the saved Betfair login." -ForegroundColor Green
    }
  }
} else {
  Write-Host "No saved credential file found. Enter credentials once to create it."
  $values = Read-NewCredentials
}

Offer-CopyFeedToken ([string]$values.BETFAIR_FEED_TOKEN)

$env:BETFAIR_APP_KEY = [string]$values.BETFAIR_APP_KEY
$env:BETFAIR_SESSION_TOKEN = [string]$values.BETFAIR_SESSION_TOKEN
$env:BETFAIR_FEED_TOKEN = [string]$values.BETFAIR_FEED_TOKEN
$env:PORT = "8080"
$values = $null

if ([string]::IsNullOrWhiteSpace($env:BETFAIR_FEED_TOKEN) -or $env:BETFAIR_FEED_TOKEN -match '\s') {
  throw "The shared token is empty or contains whitespace. Adapter was not started."
}
Write-Host "Credentials loaded into this process; secret values remain hidden." -ForegroundColor Green

# Prevent duplicate Node adapters and safely replace only the known Betfair adapter.
$listener = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1
if ($listener) {
  $portOwnerPid = [int]$listener.OwningProcess
  $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $portOwnerPid" -ErrorAction SilentlyContinue
  Write-Warning "Port 8080 is already occupied by PID $portOwnerPid."
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8080/health" -TimeoutSec 4
    Write-Host "Existing service health endpoint responded." -ForegroundColor Yellow
  } catch {
    Write-Warning "The process on port 8080 did not return a usable adapter health response."
  }

  if (-not $owner) {
    throw "Cannot identify the process owning port 8080. Nothing was stopped; no second adapter was started."
  }

  Write-Host "Process: $($owner.Name) | PID: $portOwnerPid" -ForegroundColor DarkGray
  $isBetfairAdapter = $owner.Name -ieq "node.exe" -and
    $owner.CommandLine -match 'server\.js' -and
    $owner.CommandLine -match 'betfair-au-proxy'

  if (-not $isBetfairAdapter) {
    throw "Port 8080 belongs to a different application. It was left running; no second adapter was started."
  }

  Write-Host "Recognised existing Betfair adapter. Restarting it automatically to load the current encrypted credentials..." -ForegroundColor Cyan
  Stop-Process -Id $portOwnerPid -Force
  $deadline = (Get-Date).AddSeconds(10)
  do {
    Start-Sleep -Milliseconds 400
    $stillListening = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
  } while ($stillListening -and (Get-Date) -lt $deadline)

  if ($stillListening) {
    throw "Port 8080 is still occupied after stopping the identified adapter. No duplicate was started."
  }
  Write-Host "Port 8080 is free. Starting one fresh adapter instance." -ForegroundColor Green
}

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
    $savedFeedToken = [string]$values.BETFAIR_FEED_TOKEN
    Write-Host "Sign in to Betfair through its official Australian API login. The saved shared feed token will be retained." -ForegroundColor Cyan
    $appKey = [string]$values.BETFAIR_APP_KEY
    $newSession = Get-NewBetfairSessionToken $appKey
    $values = @{
      BETFAIR_APP_KEY = $appKey
      BETFAIR_SESSION_TOKEN = $newSession
      BETFAIR_FEED_TOKEN = $savedFeedToken
    }
    if ([string]::IsNullOrWhiteSpace([string]$values.BETFAIR_APP_KEY) -or
        [string]::IsNullOrWhiteSpace([string]$values.BETFAIR_SESSION_TOKEN)) {
      throw "Missing Betfair app key or session token. Existing encrypted credentials were not replaced."
    }
    Save-EncryptedCredentials $values
    Write-Host "New Betfair credentials saved locally using Windows DPAPI; shared feed token retained." -ForegroundColor Green
    Offer-CopySessionToken ([string]$values.BETFAIR_SESSION_TOKEN)
  } else {
    Write-Host "Kept the saved encrypted Betfair credentials. If /health reports INVALID_SESSION_INFORMATION, rerun and answer Y to the sign-in prompt." -ForegroundColor Green
    $newFeedToken = Get-ClipboardFeedToken
    if ($newFeedToken -and $newFeedToken -cne [string]$values.BETFAIR_FEED_TOKEN) {
      $values.BETFAIR_FEED_TOKEN = $newFeedToken
      Save-EncryptedCredentials $values
      Write-Host "Updated the encrypted shared token; retained the saved Betfair login." -ForegroundColor Green
    }
  }
} else {
  Write-Host "No saved credential file found. Enter credentials once to create it."
  $values = Read-NewCredentials
}

Offer-CopyFeedToken ([string]$values.BETFAIR_FEED_TOKEN)

$env:BETFAIR_APP_KEY = [string]$values.BETFAIR_APP_KEY
$env:BETFAIR_SESSION_TOKEN = [string]$values.BETFAIR_SESSION_TOKEN
$env:BETFAIR_FEED_TOKEN = [string]$values.BETFAIR_FEED_TOKEN
$env:PORT = "8080"
$values = $null

if ([string]::IsNullOrWhiteSpace($env:BETFAIR_FEED_TOKEN) -or $env:BETFAIR_FEED_TOKEN -match '\s') {
  throw "The shared token is empty or contains whitespace. Adapter was not started."
}
Write-Host "Credentials loaded into this process; secret values remain hidden." -ForegroundColor Green

# Prevent duplicate Node adapters and safely replace only the known Betfair adapter.
$listener = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1
if ($listener) {
  $portOwnerPid = [int]$listener.OwningProcess
  $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $portOwnerPid" -ErrorAction SilentlyContinue
  Write-Warning "Port 8080 is already occupied by PID $portOwnerPid."
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8080/health" -TimeoutSec 4
    Write-Host "Existing service health endpoint responded." -ForegroundColor Yellow
  } catch {
    Write-Warning "The process on port 8080 did not return a usable adapter health response."
  }

  if (-not $owner) {
    throw "Cannot identify the process owning port 8080. Nothing was stopped; no second adapter was started."
  }

  Write-Host "Process: $($owner.Name) | PID: $portOwnerPid" -ForegroundColor DarkGray
  $isBetfairAdapter = $owner.Name -ieq "node.exe" -and
    $owner.CommandLine -match 'server\.js' -and
    $owner.CommandLine -match 'betfair-au-proxy'

  if (-not $isBetfairAdapter) {
    throw "Port 8080 belongs to a different application. It was left running; no second adapter was started."
  }

  Write-Host "Recognised existing Betfair adapter. Restarting it automatically to load the current encrypted credentials..." -ForegroundColor Cyan
  Stop-Process -Id $portOwnerPid -Force
  $deadline = (Get-Date).AddSeconds(10)
  do {
    Start-Sleep -Milliseconds 400
    $stillListening = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
  } while ($stillListening -and (Get-Date) -lt $deadline)

  if ($stillListening) {
    throw "Port 8080 is still occupied after stopping the identified adapter. No duplicate was started."
  }
  Write-Host "Port 8080 is free. Starting one fresh adapter instance." -ForegroundColor Green
}

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
    $savedFeedToken = [string]$values.BETFAIR_FEED_TOKEN
    Write-Host "Sign in to Betfair through its official Australian API login. The saved shared feed token will be retained." -ForegroundColor Cyan
    $appKey = [string]$values.BETFAIR_APP_KEY
    $newSession = Get-NewBetfairSessionToken $appKey
    $values = @{
      BETFAIR_APP_KEY = $appKey
      BETFAIR_SESSION_TOKEN = $newSession
      BETFAIR_FEED_TOKEN = $savedFeedToken
    }
    if ([string]::IsNullOrWhiteSpace([string]$values.BETFAIR_APP_KEY) -or
        [string]::IsNullOrWhiteSpace([string]$values.BETFAIR_SESSION_TOKEN)) {
      throw "Missing Betfair app key or session token. Existing encrypted credentials were not replaced."
    }
    Save-EncryptedCredentials $values
    Write-Host "New Betfair credentials saved locally using Windows DPAPI; shared feed token retained." -ForegroundColor Green
    Offer-CopySessionToken ([string]$values.BETFAIR_SESSION_TOKEN)
  } else {
    Write-Host "Automatically loaded saved encrypted Betfair credentials." -ForegroundColor Green
    $newFeedToken = Get-ClipboardFeedToken
    if ($newFeedToken -and $newFeedToken -cne [string]$values.BETFAIR_FEED_TOKEN) {
      $values.BETFAIR_FEED_TOKEN = $newFeedToken
      Save-EncryptedCredentials $values
      Write-Host "Updated the encrypted shared token; retained the saved Betfair login." -ForegroundColor Green
    }
  }
} else {
  Write-Host "No saved credential file found. Enter credentials once to create it."
  $values = Read-NewCredentials
}

Offer-CopyFeedToken ([string]$values.BETFAIR_FEED_TOKEN)

$env:BETFAIR_APP_KEY = [string]$values.BETFAIR_APP_KEY
$env:BETFAIR_SESSION_TOKEN = [string]$values.BETFAIR_SESSION_TOKEN
$env:BETFAIR_FEED_TOKEN = [string]$values.BETFAIR_FEED_TOKEN
$env:PORT = "8080"
$values = $null

if ([string]::IsNullOrWhiteSpace($env:BETFAIR_FEED_TOKEN) -or $env:BETFAIR_FEED_TOKEN -match '\s') {
  throw "The shared token is empty or contains whitespace. Adapter was not started."
}
Write-Host "Credentials loaded into this process; secret values remain hidden." -ForegroundColor Green

# Prevent duplicate Node adapters and safely replace only the known Betfair adapter.
$listener = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1
if ($listener) {
  $portOwnerPid = [int]$listener.OwningProcess
  $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $portOwnerPid" -ErrorAction SilentlyContinue
  Write-Warning "Port 8080 is already occupied by PID $portOwnerPid."
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8080/health" -TimeoutSec 4
    Write-Host "Existing service health endpoint responded." -ForegroundColor Yellow
  } catch {
    Write-Warning "The process on port 8080 did not return a usable adapter health response."
  }

  if (-not $owner) {
    throw "Cannot identify the process owning port 8080. Nothing was stopped; no second adapter was started."
  }

  Write-Host "Process: $($owner.Name) | PID: $portOwnerPid" -ForegroundColor DarkGray
  $isBetfairAdapter = $owner.Name -ieq "node.exe" -and
    $owner.CommandLine -match 'server\.js' -and
    $owner.CommandLine -match 'betfair-au-proxy'

  if (-not $isBetfairAdapter) {
    throw "Port 8080 belongs to a different application. It was left running; no second adapter was started."
  }

  Write-Host "Recognised existing Betfair adapter. Restarting it automatically to load the current encrypted credentials..." -ForegroundColor Cyan
  Stop-Process -Id $portOwnerPid -Force
  $deadline = (Get-Date).AddSeconds(10)
  do {
    Start-Sleep -Milliseconds 400
    $stillListening = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
  } while ($stillListening -and (Get-Date) -lt $deadline)

  if ($stillListening) {
    throw "Port 8080 is still occupied after stopping the identified adapter. No duplicate was started."
  }
  Write-Host "Port 8080 is free. Starting one fresh adapter instance." -ForegroundColor Green
}

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
    $savedFeedToken = [string]$values.BETFAIR_FEED_TOKEN
    Write-Host "Sign in to Betfair through its official Australian API login. The saved shared feed token will be retained." -ForegroundColor Cyan
    $appKey = [string]$values.BETFAIR_APP_KEY
    $newSession = Get-NewBetfairSessionToken $appKey
    $values = @{
      BETFAIR_APP_KEY = $appKey
      BETFAIR_SESSION_TOKEN = $newSession
      BETFAIR_FEED_TOKEN = $savedFeedToken
    }
    if ([string]::IsNullOrWhiteSpace([string]$values.BETFAIR_APP_KEY) -or
        [string]::IsNullOrWhiteSpace([string]$values.BETFAIR_SESSION_TOKEN)) {
      throw "Missing Betfair app key or session token. Existing encrypted credentials were not replaced."
    }
    Save-EncryptedCredentials $values
    Write-Host "New Betfair credentials saved locally using Windows DPAPI; shared feed token retained." -ForegroundColor Green
    Offer-CopySessionToken ([string]$values.BETFAIR_SESSION_TOKEN)
  } else {
    Write-Host "Kept the saved encrypted Betfair credentials. If /health reports INVALID_SESSION_INFORMATION, rerun and answer Y to the sign-in prompt." -ForegroundColor Green
    $newFeedToken = Get-ClipboardFeedToken
    if ($newFeedToken -and $newFeedToken -cne [string]$values.BETFAIR_FEED_TOKEN) {
      $values.BETFAIR_FEED_TOKEN = $newFeedToken
      Save-EncryptedCredentials $values
      Write-Host "Updated the encrypted shared token; retained the saved Betfair login." -ForegroundColor Green
    }
  }
} else {
  Write-Host "No saved credential file found. Enter credentials once to create it."
  $values = Read-NewCredentials
}

Offer-CopyFeedToken ([string]$values.BETFAIR_FEED_TOKEN)

$env:BETFAIR_APP_KEY = [string]$values.BETFAIR_APP_KEY
$env:BETFAIR_SESSION_TOKEN = [string]$values.BETFAIR_SESSION_TOKEN
$env:BETFAIR_FEED_TOKEN = [string]$values.BETFAIR_FEED_TOKEN
$env:PORT = "8080"
$values = $null

if ([string]::IsNullOrWhiteSpace($env:BETFAIR_FEED_TOKEN) -or $env:BETFAIR_FEED_TOKEN -match '\s') {
  throw "The shared token is empty or contains whitespace. Adapter was not started."
}
Write-Host "Credentials loaded into this process; secret values remain hidden." -ForegroundColor Green

# Prevent duplicate Node adapters and safely replace only the known Betfair adapter.
$listener = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1
if ($listener) {
  $portOwnerPid = [int]$listener.OwningProcess
  $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $portOwnerPid" -ErrorAction SilentlyContinue
  Write-Warning "Port 8080 is already occupied by PID $portOwnerPid."
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8080/health" -TimeoutSec 4
    Write-Host "Existing service health endpoint responded." -ForegroundColor Yellow
  } catch {
    Write-Warning "The process on port 8080 did not return a usable adapter health response."
  }

  if (-not $owner) {
    throw "Cannot identify the process owning port 8080. Nothing was stopped; no second adapter was started."
  }

  Write-Host "Process: $($owner.Name) | PID: $portOwnerPid" -ForegroundColor DarkGray
  $isBetfairAdapter = $owner.Name -ieq "node.exe" -and
    $owner.CommandLine -match 'server\.js' -and
    $owner.CommandLine -match 'betfair-au-proxy'

  if (-not $isBetfairAdapter) {
    throw "Port 8080 belongs to a different application. It was left running; no second adapter was started."
  }

  Write-Host "Recognised existing Betfair adapter. Restarting it automatically to load the current encrypted credentials..." -ForegroundColor Cyan
  Stop-Process -Id $portOwnerPid -Force
  $deadline = (Get-Date).AddSeconds(10)
  do {
    Start-Sleep -Milliseconds 400
    $stillListening = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
  } while ($stillListening -and (Get-Date) -lt $deadline)

  if ($stillListening) {
    throw "Port 8080 is still occupied after stopping the identified adapter. No duplicate was started."
  }
  Write-Host "Port 8080 is free. Starting one fresh adapter instance." -ForegroundColor Green
}

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
    $savedFeedToken = [string]$values.BETFAIR_FEED_TOKEN
    Write-Host "Sign in to Betfair through its official Australian API login. The saved shared feed token will be retained." -ForegroundColor Cyan
    $appKey = [string]$values.BETFAIR_APP_KEY
    $newSession = Get-NewBetfairSessionToken $appKey
    $values = @{
      BETFAIR_APP_KEY = $appKey
      BETFAIR_SESSION_TOKEN = $newSession
      BETFAIR_FEED_TOKEN = $savedFeedToken
    }
    if ([string]::IsNullOrWhiteSpace([string]$values.BETFAIR_APP_KEY) -or
        [string]::IsNullOrWhiteSpace([string]$values.BETFAIR_SESSION_TOKEN)) {
      throw "Missing Betfair app key or session token. Existing encrypted credentials were not replaced."
    }
    Save-EncryptedCredentials $values
    Write-Host "New Betfair credentials saved locally using Windows DPAPI; shared feed token retained." -ForegroundColor Green
    Offer-CopySessionToken ([string]$values.BETFAIR_SESSION_TOKEN)
  } else {
    Write-Host "Automatically loaded saved encrypted Betfair credentials." -ForegroundColor Green
    $newFeedToken = Get-ClipboardFeedToken
    if ($newFeedToken -and $newFeedToken -cne [string]$values.BETFAIR_FEED_TOKEN) {
      $values.BETFAIR_FEED_TOKEN = $newFeedToken
      Save-EncryptedCredentials $values
      Write-Host "Updated the encrypted shared token; retained the saved Betfair login." -ForegroundColor Green
    }
  }
} else {
  Write-Host "No saved credential file found. Enter credentials once to create it."
  $values = Read-NewCredentials
}

Offer-CopyFeedToken ([string]$values.BETFAIR_FEED_TOKEN)

$env:BETFAIR_APP_KEY = [string]$values.BETFAIR_APP_KEY
$env:BETFAIR_SESSION_TOKEN = [string]$values.BETFAIR_SESSION_TOKEN
$env:BETFAIR_FEED_TOKEN = [string]$values.BETFAIR_FEED_TOKEN
$env:PORT = "8080"
$values = $null

if ([string]::IsNullOrWhiteSpace($env:BETFAIR_FEED_TOKEN) -or $env:BETFAIR_FEED_TOKEN -match '\s') {
  throw "The shared token is empty or contains whitespace. Adapter was not started."
}
Write-Host "Credentials loaded into this process; secret values remain hidden." -ForegroundColor Green

# Prevent duplicate Node adapters and safely replace only the known Betfair adapter.
$listener = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1
if ($listener) {
  $portOwnerPid = [int]$listener.OwningProcess
  $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $portOwnerPid" -ErrorAction SilentlyContinue
  Write-Warning "Port 8080 is already occupied by PID $portOwnerPid."
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8080/health" -TimeoutSec 4
    Write-Host "Existing service health endpoint responded." -ForegroundColor Yellow
  } catch {
    Write-Warning "The process on port 8080 did not return a usable adapter health response."
  }

  if (-not $owner) {
    throw "Cannot identify the process owning port 8080. Nothing was stopped; no second adapter was started."
  }

  Write-Host "Process: $($owner.Name) | PID: $portOwnerPid" -ForegroundColor DarkGray
  $isBetfairAdapter = $owner.Name -ieq "node.exe" -and
    $owner.CommandLine -match 'server\.js' -and
    $owner.CommandLine -match 'betfair-au-proxy'

  if (-not $isBetfairAdapter) {
    throw "Port 8080 belongs to a different application. It was left running; no second adapter was started."
  }

  Write-Host "Recognised existing Betfair adapter. Restarting it automatically to load the current encrypted credentials..." -ForegroundColor Cyan
  Stop-Process -Id $portOwnerPid -Force
  $deadline = (Get-Date).AddSeconds(10)
  do {
    Start-Sleep -Milliseconds 400
    $stillListening = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
  } while ($stillListening -and (Get-Date) -lt $deadline)

  if ($stillListening) {
    throw "Port 8080 is still occupied after stopping the identified adapter. No duplicate was started."
  }
  Write-Host "Port 8080 is free. Starting one fresh adapter instance." -ForegroundColor Green
}

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
