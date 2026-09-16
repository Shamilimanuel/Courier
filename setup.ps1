<#
    Courier -- one-line setup for the PC agent.

        irm github.com/Shamilimanuel/Courier/raw/main/setup.ps1 | iex

    Installs the agent under %LOCALAPPDATA%\Courier, makes it start when you
    log in, and finishes by printing the pairing details for the phone.

    No administrator rights needed -- the agent only ever does what your own
    session could already do (read/write the clipboard, save files to your
    Downloads folder).

    Options (these need the longer form, because `iex` cannot take arguments):

        & ([scriptblock]::Create((irm <url>))) -Uninstall
        & ([scriptblock]::Create((irm <url>))) -Path 'D:\somewhere'
        & ([scriptblock]::Create((irm <url>))) -NoAutoStart
        & ([scriptblock]::Create((irm <url>))) -NoPair

    Re-running it upgrades in place and keeps your existing token, so the
    phone does not need re-pairing.
#>

[CmdletBinding()]
param(
    # Remove the agent, its scheduled task and its files.
    [switch]$Uninstall,
    # Where to install. Defaults to %LOCALAPPDATA%\Courier.
    [string]$Path,
    # Skip printing the pairing code at the end.
    [switch]$NoPair,
    # Install without registering it to start at login.
    [switch]$NoAutoStart
)

$ErrorActionPreference = 'Stop'

$Repo       = 'Shamilimanuel/Courier'
$Branch     = 'main'
$TaskName   = 'CourierAgent'
$InstallDir = if ($Path) { $Path } else { Join-Path $env:LOCALAPPDATA 'Courier' }

function Write-Step  { param([string]$m) Write-Host "  $m" -ForegroundColor Cyan }
function Write-Ok    { param([string]$m) Write-Host "  $m" -ForegroundColor Green }
function Write-Warn2 { param([string]$m) Write-Host "  $m" -ForegroundColor Yellow }
function Write-Dim   { param([string]$m) Write-Host "  $m" -ForegroundColor DarkGray }

function Write-Banner {
    $rule = [string][char]0x2500   # horizontal rule
    Write-Host ''
    Write-Host '  Courier' -ForegroundColor Cyan
    Write-Host ('  ' + ($rule * 50)) -ForegroundColor DarkGray
    Write-Host '   send text, clipboard and files between phone and PC' -ForegroundColor Gray
    Write-Host ('  ' + ($rule * 50)) -ForegroundColor DarkGray
    Write-Host ''
}

# ---------------------------------------------------------------- uninstall --

function Invoke-Uninstall {
    Write-Banner
    Write-Step 'Removing Courier...'

    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Dim "removed scheduled task '$TaskName'"
    }

    Stop-WhateverHoldsThePort -Port (Read-AgentPort -Destination $InstallDir)

    if (Test-Path $InstallDir) {
        Remove-Item $InstallDir -Recurse -Force
        Write-Dim "deleted $InstallDir"
    }

    Write-Host ''
    Write-Ok 'Courier removed.'
    Write-Dim 'The app on your phone can be uninstalled the normal way.'
    Write-Host ''
}

# ------------------------------------------------------------------- node.js --

function Resolve-Node {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if ($node) {
        $version = (& $node.Source --version).TrimStart('v')
        if ([int]($version -split '\.')[0] -ge 20) {
            Write-Dim "Node.js $version"
            return $node.Source
        }
        Write-Warn2 "Node.js $version is too old (20 or newer needed)."
    } else {
        Write-Step 'Node.js is not installed. It is what runs the agent.'
    }

    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Step 'Installing Node.js via winget...'
        winget install --id OpenJS.NodeJS.LTS --source winget --accept-package-agreements --accept-source-agreements --silent | Out-Null

        # winget does not refresh this session's PATH.
        $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                    [Environment]::GetEnvironmentVariable('Path', 'User')
        $node = Get-Command node -ErrorAction SilentlyContinue
        if ($node) {
            Write-Ok "Node.js installed."
            return $node.Source
        }
        Write-Warn2 'Node.js was installed but this window cannot see it yet.'
        Write-Warn2 'Close this terminal, open a new one, and run the same command again.'
        exit 1
    }

    Write-Host ''
    Write-Warn2 'Install Node.js first, then run this again:'
    Write-Warn2 '  https://nodejs.org  (take the LTS download)'
    Write-Host ''
    exit 1
}

# ------------------------------------------------------------------ download --

function Get-AgentFiles {
    param([string]$Destination)

    $zipUrl = "https://github.com/$Repo/archive/refs/heads/$Branch.zip"
    $tmp = Join-Path ([System.IO.Path]::GetTempPath()) "courier-$([guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Path $tmp -Force | Out-Null
    $zip = Join-Path $tmp 'src.zip'

    Write-Step 'Downloading the agent...'
    $progress = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue'   # the progress bar makes this 10x slower
    try {
        Invoke-WebRequest -Uri $zipUrl -OutFile $zip -UseBasicParsing
    } finally {
        $ProgressPreference = $progress
    }

    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    $source = Join-Path $tmp "Courier-$Branch\agent"
    if (-not (Test-Path $source)) {
        throw "The download did not contain the agent. Expected $source"
    }

    # Keep the existing token, or the phone would have to be paired again.
    $existingConfig = Join-Path $Destination 'config.json'
    $savedConfig = $null
    if (Test-Path $existingConfig) {
        $savedConfig = Get-Content $existingConfig -Raw
        Write-Dim 'keeping your existing token'
    }

    if (Test-Path $Destination) {
        # node_modules is re-installed below; everything else is replaceable.
        Get-ChildItem $Destination -Force | Where-Object { $_.Name -ne 'node_modules' } |
            Remove-Item -Recurse -Force
    } else {
        New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    }

    Copy-Item (Join-Path $source '*') $Destination -Recurse -Force

    if ($savedConfig) {
        # No BOM: Set-Content -Encoding UTF8 adds one, and JSON.parse rejects it.
        [System.IO.File]::WriteAllText($existingConfig, $savedConfig, (New-Object System.Text.UTF8Encoding $false))
    }

    try {
        $head = Invoke-RestMethod "https://api.github.com/repos/$Repo/commits/$Branch" `
            -Headers @{ 'User-Agent' = 'courier-setup' } -TimeoutSec 10
        $stamp = @{ sha = $head.sha; installedAt = (Get-Date).ToString('o') } | ConvertTo-Json
        [System.IO.File]::WriteAllText(
            (Join-Path $Destination 'installed.json'), $stamp,
            (New-Object System.Text.UTF8Encoding $false))
    } catch {
        Write-Dim 'could not record the installed version (update checks will stay quiet)'
    }

    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    Write-Dim "installed to $Destination"
}

# --------------------------------------------------------------- scheduling --

function Register-Agent {
    param([string]$Destination)

    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    }

    $launcher = Join-Path $Destination 'start-agent-hidden.vbs'
    $action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$launcher`"" -WorkingDirectory $Destination
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
        -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
        -Settings $settings -Principal $principal -Force | Out-Null
    Write-Dim 'starts automatically when you log in'
}

# -------------------------------------------------------------------- verify --

function Stop-WhateverHoldsThePort {
    param([int]$Port)

    $owners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($owner in $owners) {
        $proc = Get-Process -Id $owner -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Dim "stopping what was already on port $Port ($($proc.ProcessName), pid $owner)"
            Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
        }
    }
    if ($owners) { Start-Sleep -Seconds 1 }
}

function Read-AgentPort {
    param([string]$Destination)
    $configPath = Join-Path $Destination 'config.json'
    if (Test-Path $configPath) {
        try { return [int]((Get-Content $configPath -Raw | ConvertFrom-Json).port) } catch { }
    }
    return 5544
}

function Test-Agent {
    param([string]$Destination)

    $configPath = Join-Path $Destination 'config.json'
    for ($i = 0; $i -lt 20; $i++) {
        if (Test-Path $configPath) { break }
        Start-Sleep -Milliseconds 500
    }
    if (-not (Test-Path $configPath)) { return $null }

    $config = Get-Content $configPath -Raw | ConvertFrom-Json

    for ($i = 0; $i -lt 20; $i++) {
        try {
            $r = Invoke-WebRequest -Uri "http://127.0.0.1:$($config.port)/health" -TimeoutSec 3 -UseBasicParsing
            if ($r.StatusCode -eq 200) {
                return $r.Content | ConvertFrom-Json
            }
        } catch { }
        Start-Sleep -Milliseconds 500
    }
    return $null
}

# ----------------------------------------------------------------- menu --

function Show-Menu {
    param([string]$Destination)

    $installed = $null
    $stamp = Join-Path $Destination 'installed.json'
    if (Test-Path $stamp) {
        try { $installed = (Get-Content $stamp -Raw | ConvertFrom-Json).sha } catch { }
    }

    Write-Host '  Courier is already installed here:' -ForegroundColor White
    Write-Dim "  $Destination"
    if ($installed) { Write-Dim "  version $($installed.Substring(0,7))" }

    $running = Get-NetTCPConnection -LocalPort (Read-AgentPort -Destination $Destination) `
        -State Listen -ErrorAction SilentlyContinue
    if ($running) { Write-Ok '  The agent is running.' } else { Write-Warn2 '  The agent is not running.' }

    Write-Host ''
    Write-Host '   1  Update to the latest version' -ForegroundColor White
    Write-Host '   2  Repair  ' -ForegroundColor White -NoNewline
    Write-Dim '(reinstall, re-register, restart)'
    Write-Host '   3  Show the pairing details' -ForegroundColor White
    Write-Host '   4  Remove Courier' -ForegroundColor White
    Write-Host '   Q  Quit' -ForegroundColor White
    Write-Host ''

    $choice = Read-Host '  Choose'
    switch ($choice.Trim().ToUpper()) {
        '1' { return 'update' }
        '2' { return 'repair' }
        '3' { return 'pair' }
        '4' { return 'remove' }
        'Q' { return 'quit' }
        default {
            Write-Warn2 '  Not one of the options.'
            return 'quit'
        }
    }
}

function Show-PairingCode {
    param([string]$Destination, [string]$NodePath)
    Push-Location $Destination
    try { & $NodePath 'src\pair.js' } finally { Pop-Location }
}

# ---------------------------------------------------------------------- main --

if ($Uninstall) { Invoke-Uninstall; return }

Write-Banner

$nodePath = Resolve-Node

$alreadyInstalled = (Test-Path (Join-Path $InstallDir 'package.json')) -and
                    (Test-Path (Join-Path $InstallDir 'node_modules'))
$repairing = $false
if ($alreadyInstalled -and -not $NoAutoStart -and -not $NoPair -and [Environment]::UserInteractive) {
    switch (Show-Menu -Destination $InstallDir) {
        'quit'   { Write-Host ''; return }
        'remove' { Invoke-Uninstall; return }
        'pair'   { Show-PairingCode -Destination $InstallDir -NodePath $nodePath; return }
        'repair' { $repairing = $true; Write-Host '' }
        'update' { Write-Host '' }
    }
}
Get-AgentFiles -Destination $InstallDir

Write-Step 'Installing what it needs...'
Push-Location $InstallDir
try {
    # npm.cmd, not npm. In PowerShell `npm` resolves to npm.ps1, and a fresh
    # Windows install refuses to run any .ps1 at all. The .cmd shim does the
    # same job and no execution policy applies to it.
    & npm.cmd install --omit=dev --no-audit --no-fund --loglevel=error 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'npm install failed. Check your internet connection and try again.' }
} finally {
    Pop-Location
}

if ($NoAutoStart) {
    Write-Dim 'skipping the start-at-login step, as asked'
} else {
    Write-Step $(if ($repairing) { 'Re-registering the start-at-login task...' }
                 else { 'Setting it to start with Windows...' })
    Register-Agent -Destination $InstallDir
}

Write-Step 'Starting the agent...'
Stop-WhateverHoldsThePort -Port (Read-AgentPort -Destination $InstallDir)

if ($NoAutoStart) {
    Start-Process wscript.exe -ArgumentList "`"$(Join-Path $InstallDir 'start-agent-hidden.vbs')`"" -WorkingDirectory $InstallDir
} else {
    Start-ScheduledTask -TaskName $TaskName
}

$health = Test-Agent -Destination $InstallDir
if (-not $health) {
    Write-Host ''
    Write-Warn2 'The agent did not answer. Something is wrong.'
    Write-Warn2 "Run this to see why:  cd `"$InstallDir`"; node src\index.js"
    Write-Host ''
    exit 1
}

$blocked = -not (Get-NetFirewallRule -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -match 'node' -and $_.Enabled -eq 'True' -and $_.Action -eq 'Allow' -and $_.Direction -eq 'Inbound' })

Write-Host ''
Write-Ok "Done. $($health.hostname) is ready."
Write-Host ''
Write-Dim 'Addresses this PC can be reached on:'
foreach ($i in $health.interfaces) {
    Write-Host ("   {0,-14} {1}" -f $i.interface, $i.ip) -ForegroundColor Gray
}
Write-Host ''

if ($blocked) {
    Write-Warn2 'Windows Firewall has no rule allowing Node.js in. If the phone'
    Write-Warn2 'cannot connect, allow it when Windows asks, or add it manually.'
    Write-Host ''
}

Write-Host '  Get the Android app:' -ForegroundColor White
Write-Dim "  https://github.com/$Repo/releases/latest"
Write-Host ''

Write-Host '  To show the pairing details again later:' -ForegroundColor White
Write-Dim "  cd `"$InstallDir`"; node src\pair.js"
Write-Host ''

if (-not $NoPair) {
    Write-Step 'Scan this with the app to pair, or enter the details by hand:'
    Write-Host ''
    Push-Location $InstallDir
    try { & $nodePath 'src\pair.js' } finally { Pop-Location }
}
