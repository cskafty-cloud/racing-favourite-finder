$ErrorActionPreference = "Stop"
$RffLauncherVersion = "2026-11-13.13"
Set-Location $PSScriptRoot

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
function Get-ClipboardFeedToken {
  try {
    $candidate = ([string](Get-Clipboard -Raw -ErrorAction Stop)).Trim()
  } catch {
    $candidate = ""
  }
  if ($candidate -cmatch '^[A-Fa-f0-9]{64}$') { return $candidate }
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
    throw "Clipboard must contain only the 64-character hexadecimal Railway shared token. Copy the token itself, not a command or output. No credentials were saved."
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
      ([string]$values.BETFAIR_FEED_TOKEN) -cnotmatch '^[A-Fa-f0-9]{64}$') {
    throw "Railway Betfair variables are incomplete or the shared token is not 64 hexadecimal characters. No credentials were saved."
  }
  Save-EncryptedCredentials $values
  Write-Host "Imported Railway Production Betfair variables and saved them encrypted with Windows DPAPI." -ForegroundColor Green
} elseif (Test-Path -LiteralPath $CredentialFile) {
  # Allow a fresh session to be entered without changing the separate shared feed token.
  $values = Load-EncryptedCredentials
  $credentialChoice = Read-Host "Use saved encrypted credentials? [Y/n]"
  if ($credentialChoice -match '^(n|no)$') {
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

$env:BETFAIR_APP_KEY = [string]$values.BETFAIR_APP_KEY
$env:BETFAIR_SESSION_TOKEN = [string]$values.BETFAIR_SESSION_TOKEN
$env:BETFAIR_FEED_TOKEN = [string]$values.BETFAIR_FEED_TOKEN
$env:PORT = "8080"
$values = $null

if ($env:BETFAIR_FEED_TOKEN -cnotmatch '^[A-Fa-f0-9]{64}$') {
  throw "The shared token is invalid. Adapter was not started."
}
Write-Host "Credentials loaded into this process; secret values remain hidden." -ForegroundColor Green

# Prevent duplicate Node adapters from racing for the same port.
$listener = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1
if ($listener) {
  $listenerPid = [int]$listener.OwningProcess
  $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $listenerPid" -ErrorAction SilentlyContinue
  Write-Warning "Port 8080 is already occupied by PID $listenerPid."
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8080/health" -TimeoutSec 4
    Write-Host "An adapter is already answering its health endpoint." -ForegroundColor Yellow
    if ($health.ok -eq $true) {
      Write-Host "Health: OK. No second adapter will be started." -ForegroundColor Green
    } else {
      Write-Host "Health endpoint responded, but did not report ok=true. Review its status before restarting." -ForegroundColor Yellow
    }
  } catch {
    Write-Warning "The process on port 8080 did not return a usable adapter health response."
  }
  if ($owner) {
    Write-Host "Process: $($owner.Name) | PID: $listenerPid" -ForegroundColor DarkGray
    if ($owner.Name -ieq "node.exe" -and $owner.CommandLine -match 'server\.js' -and $owner.CommandLine -match 'betfair-au-proxy') {
      $stopChoice = Read-Host "This appears to be the existing Betfair adapter. Stop PID $listenerPid so the refreshed credentials can be used? [y/N]"
      if ($stopChoice -match '^(y|yes)$') {
        Stop-Process -Id $listenerPid -Force
        Start-Sleep -Seconds 2
        $stillListening = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
        if ($stillListening) {
          throw "Port 8080 is still occupied. No second adapter was started."
        }
      } else {
        Write-Host "Leaving the existing process untouched. Close its original PowerShell window with Ctrl+C, then rerun this launcher." -ForegroundColor Yellow
        return
      }
    } else {
      Write-Host "The process does not match the expected adapter command. It was not stopped. Close the owning application or free port 8080, then rerun." -ForegroundColor Yellow
      return
    }
  } else {
    Write-Host "Could not identify the process owning port 8080. Nothing was stopped. Free the port and rerun." -ForegroundColor Yellow
    return
  }
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
