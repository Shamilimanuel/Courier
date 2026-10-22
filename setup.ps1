<#
    Courier -- one-line setup, the same way Reveille does it.

        irm github.com/Shamilimanuel/Courier/raw/main/setup.ps1 | iex

    Installs the Courier desktop app (the tray app with a window) from the
    newest GitHub release, quietly and just for you -- no administrator
    rights. Adds a `courier` command: type it in PowerShell, cmd or Win+R and
    the window opens. Run the line again for a menu: update, open, remove.

    A PC that had the older window-less agent keeps its pairing token: the
    desktop app reads the same config.json, so phones don't re-pair. The
    agent's start-at-login task is removed, because both would want the same
    port.

    Options (these need the longer form, because `iex` cannot take arguments):

        & ([scriptblock]::Create((irm <url>))) -Uninstall
        & ([scriptblock]::Create((irm <url>))) -Agent          the window-less agent instead
        & ([scriptblock]::Create((irm <url>))) -Agent -Path 'D:\somewhere'
        & ([scriptblock]::Create((irm <url>))) -Agent -NoAutoStart
        & ([scriptblock]::Create((irm <url>))) -Agent -NoPair

    The window-less agent (-Agent) installs under %LOCALAPPDATA%\Courier,
    starts when you log in and prints the pairing details; re-running it
    upgrades in place and keeps the token.
#>

[CmdletBinding()]
param(
    # Remove Courier: the desktop app, the agent, the command and their files.
    [switch]$Uninstall,
    # Install the window-less agent instead of the desktop app.
    [switch]$Agent,
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

<#
    The banner.

    Drawn from a bitmap rather than pasted as literal block characters, so
    this file stays plain ASCII -- PowerShell 5.1 reads a .ps1 as ANSI
    unless it has a byte-order mark, and pasted block art turns to
    mojibake. Built from [char] codes it renders correctly however the
    script is fetched or run.

    Signal teal, not Reveille's cyan-to-blue -- Courier gets its own mark.
#>

$script:Glyphs = @{
    'C' = @('.####', '#....', '#....', '#....', '.####')
    'O' = @('.###.', '#...#', '#...#', '#...#', '.###.')
    'U' = @('#...#', '#...#', '#...#', '#...#', '.###.')
    'R' = @('####.', '#...#', '####.', '#..#.', '#...#')
    'I' = @('#####', '..#..', '..#..', '..#..', '#####')
    'E' = @('#####', '#....', '####.', '#....', '#####')
}

function Write-Banner {
    $block = [string][char]0x2588      # full block
    $rule = [string][char]0x2500       # horizontal rule
    $word = 'COURIER'

    # Bright signal teal at the top, settling to a deeper teal below -- one
    # hue, not a blend, since the whole identity is a single accent colour.
    $gradient = @('Cyan', 'Cyan', 'DarkCyan', 'DarkCyan', 'DarkCyan')

    Write-Host ''
    for ($row = 0; $row -lt 5; $row++) {
        Write-Host '  ' -NoNewline
        for ($i = 0; $i -lt $word.Length; $i++) {
            $line = $script:Glyphs[[string]$word[$i]][$row]
            $text = ($line -replace '#', $block) -replace '\.', ' '
            $colour = if ($i -eq 0) { 'White' } else { $gradient[$row] }
            Write-Host "$text " -ForegroundColor $colour -NoNewline
        }
        Write-Host ''
    }

    Write-Host ''
    Write-Host ('  ' + ($rule * 54)) -ForegroundColor DarkGray
    Write-Host '   send text, clipboard and files between phone and PC' -ForegroundColor Gray
    Write-Host ('  ' + ($rule * 54)) -ForegroundColor DarkGray
    Write-Host ''
}

# ------------------------------------------------------------ desktop app --

$CommandFile = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\courier.cmd'

# The installed desktop app, from the entry its installer writes for
# Settings > Apps, or $null.
function Get-DesktopInstall {
    $keys = Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue
    foreach ($k in $keys) {
        $p = Get-ItemProperty $k.PSPath -ErrorAction SilentlyContinue
        if ($p.DisplayName -notlike 'Courier*') { continue }
        # electron-builder leaves InstallLocation empty; DisplayIcon is
        # "...\Courier.exe,0".
        $exe = ([string]$p.DisplayIcon -replace ',\d+$', '').Trim('"')
        if (-not $exe -or -not (Test-Path $exe)) { continue }
        return [pscustomobject]@{
            Version   = [string]$p.DisplayVersion
            Dir       = Split-Path $exe
            Exe       = $exe
            Uninstall = if ($p.QuietUninstallString) { $p.QuietUninstallString } else { [string]$p.UninstallString }
        }
    }
    $null
}

# The newest desktop release on GitHub: its version and the installer's
# address. electron-builder makes "Courier Setup 1.1.0.exe" (the installer)
# and "Courier 1.1.0.exe" (portable); GitHub turns the spaces into dots.
function Get-LatestDesktopRelease {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $releases = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases" -Headers @{ Accept = 'application/vnd.github+json' } -UseBasicParsing
    foreach ($r in @($releases)) {
        if ($r.tag_name -notlike 'desktop-v*' -or $r.draft -or $r.prerelease) { continue }
        $exe = @($r.assets | Where-Object { $_.name -match '\.exe$' -and $_.name -match 'setup' }) | Select-Object -First 1
        if ($exe) {
            return [pscustomobject]@{ Version = $r.tag_name -replace '^desktop-v', ''; Url = $exe.browser_download_url; Name = $exe.name; Size = $exe.size }
        }
    }
    throw 'GitHub has no desktop installer yet. Try again in a few minutes.'
}

# The older window-less agent: its start-at-login task goes, its config.json
# (the pairing token) stays for the desktop app to pick up.
function Remove-AgentTask {
    if (-not (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)) { return }
    Write-Step 'Turning off the older window-less agent (your pairing stays)...'
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Stop-WhateverHoldsThePort -Port (Read-AgentPort -Destination $InstallDir)
}

# `courier` in PowerShell, cmd or Win+R. WindowsApps is already on the PATH.
# `courier -Setup` runs this setup again (the menu).
function Set-CourierCommand {
    param([string]$Exe)
    $lines = @(
        '@echo off'
        'rem Courier. Made by the one-line setup; run it again (or: courier -Setup) to update or remove.'
        'if /i "%~1"=="-Setup" ('
        "    powershell.exe -NoProfile -Command `"irm github.com/$Repo/raw/$Branch/setup.ps1 | iex`""
        '    goto :eof'
        ')'
        "start `"`" `"$Exe`" --show"
    )
    New-Item -ItemType Directory -Force -Path (Split-Path $CommandFile) | Out-Null
    [IO.File]::WriteAllText($CommandFile, (($lines -join "`r`n") + "`r`n"), (New-Object Text.ASCIIEncoding))
}

function Install-Desktop {
    $release = Get-LatestDesktopRelease
    $file = Join-Path $env:TEMP ("courier-setup-" + $release.Version + ".exe")
    Write-Step ("Downloading Courier {0} ({1:N0} MB)..." -f $release.Version, ($release.Size / 1MB))
    Invoke-WebRequest $release.Url -OutFile $file -UseBasicParsing

    Remove-AgentTask

    # The installer cannot replace a running app.
    Get-Process -Name 'Courier' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Write-Step 'Installing it, just for you...'
    $p = Start-Process -FilePath $file -ArgumentList '/S', '/currentuser' -PassThru -Wait
    Remove-Item $file -Force -ErrorAction SilentlyContinue
    if ($p.ExitCode -ne 0) { throw "The installer stopped with code $($p.ExitCode)." }

    $installed = Get-DesktopInstall
    if (-not $installed) { throw 'The installer finished, but Courier is not where it should be.' }
    Set-CourierCommand -Exe $installed.Exe
    $installed
}

function Remove-Desktop {
    $installed = Get-DesktopInstall
    if ($installed) {
        Get-Process -Name 'Courier' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        Write-Step 'Removing the desktop app...'
        $cmd = $installed.Uninstall
        if ($cmd -match '^"([^"]+)"\s*(.*)$') { $exe = $Matches[1]; $uargs = $Matches[2] } else { $exe = $cmd; $uargs = '' }
        if ($uargs -notmatch '/S') { $uargs = ($uargs + ' /S').Trim() }
        Start-Process -FilePath $exe -ArgumentList $uargs -Wait
        # The uninstaller hands over to a copy of itself and returns at once;
        # wait for the app to be gone, then take the empty folder too.
        for ($n = 0; $n -lt 60 -and (Test-Path $installed.Exe); $n++) { Start-Sleep -Milliseconds 500 }
        if ((Test-Path $installed.Dir) -and -not (Get-ChildItem $installed.Dir -Force)) { Remove-Item $installed.Dir -Force }
        Remove-Item 'HKCU:\Software\Classes\*\shell\SendWithCourier' -Recurse -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path $CommandFile) { Remove-Item $CommandFile -Force }
}

function Show-DesktopMenu {
    param($Installed, $Latest)
    Write-Host ("  Courier {0} is installed." -f $Installed.Version) -ForegroundColor White
    if ($Latest -and $Latest.Version -ne $Installed.Version) { Write-Ok ("  Version {0} is out." -f $Latest.Version) }
    elseif ($Latest) { Write-Dim '  That is the newest version.' }
    Write-Host ''
    Write-Host ('   1  ' + $(if ($Latest -and $Latest.Version -ne $Installed.Version) { "Update to $($Latest.Version)" } else { 'Reinstall (repair)' })) -ForegroundColor White
    Write-Host '   2  Open Courier' -ForegroundColor White
    Write-Host '   3  Remove Courier' -ForegroundColor White
    Write-Host '   Q  Quit' -ForegroundColor White
    Write-Host ''
    switch ((Read-Host '  Choose').Trim().ToUpper()) {
        '1' { 'install' }
        '2' { 'open' }
        '3' { 'remove' }
        default { 'quit' }
    }
}

function Invoke-Desktop {
    Write-Banner
    $installed = Get-DesktopInstall
    if ($installed -and [Environment]::UserInteractive) {
        $latest = $null
        try { $latest = Get-LatestDesktopRelease } catch { }
        switch (Show-DesktopMenu -Installed $installed -Latest $latest) {
            'open'   { Start-Process $installed.Exe -ArgumentList '--show'; Write-Host ''; return }
            'remove' { Invoke-Uninstall; return }
            'quit'   { Write-Host ''; return }
        }
        Write-Host ''
    }

    $installed = Install-Desktop
    Start-Process $installed.Exe -ArgumentList '--show'

    Write-Host ''
    Write-Ok ("Done. Courier {0} is open." -f $installed.Version)
    Write-Host ''
    Write-Host '  From now on:' -ForegroundColor White
    Write-Dim '  courier          opens the window (it also starts with Windows, in the tray)'
    Write-Dim '  courier -Setup   update or remove'
    Write-Host ''
    Write-Host '  If Windows asks whether Courier may use the network, allow it' -ForegroundColor White
    Write-Dim '  for private networks: that is how your phone reaches this PC.'
    Write-Host ''
    Write-Host '  Pair your phone under Pair in the window. The Android app:' -ForegroundColor White
    Write-Dim "  https://github.com/$Repo/releases/latest"
    Write-Host ''
}

# ---------------------------------------------------------------- uninstall --

function Invoke-Uninstall {
    Write-Banner
    Write-Step 'Removing Courier...'

    Remove-Desktop

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

# The desktop app, unless the window-less agent was asked for.
if (-not $Agent) {
    try { Invoke-Desktop }
    catch {
        Write-Host ''
        Write-Warn2 "That did not work: $($_.Exception.Message)"
        Write-Dim 'Run the same line again, or use the window-less agent: add -Agent (see the top of setup.ps1).'
        Write-Host ''
    }
    return
}

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
