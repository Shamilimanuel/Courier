<#
    Courier -- one-line setup, the same way Reveille does it.

        irm github.com/Shamilimanuel/Courier/raw/main/setup.ps1 | iex

    Opens the Courier setup window, made like Reveille's: a first install is
    three steps (the phone app, installing on this PC, pairing), and after
    that it has pages for this PC, the phone app and maintenance (update,
    repair, remove). It installs the Courier desktop app (the tray app with a
    window) from the newest GitHub release, quietly and just for you -- no
    administrator rights -- and adds a `courier` command: type it in
    PowerShell, cmd or Win+R and Courier opens; `courier -Setup` opens this
    setup window again. Without a desktop (SSH, -Console) it is the same in
    text: a menu to update, open or remove.

    A PC that had the older window-less agent keeps its pairing token: the
    desktop app reads the same config.json, so phones don't re-pair. The
    agent's start-at-login task is removed, because both would want the same
    port.

    Options (these need the longer form, because `iex` cannot take arguments):

        & ([scriptblock]::Create((irm <url>))) -Uninstall
        & ([scriptblock]::Create((irm <url>))) -Console        the text version, no window
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
    # The text version instead of the setup window.
    [switch]$Console,
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
    # Windows PowerShell draws a progress bar for every block it downloads,
    # which makes a large download many times slower.
    $ProgressPreference = 'SilentlyContinue'
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
            'remove' {
                Remove-Courier
                Write-Host ''
                Write-Ok 'Courier removed.'
                Write-Host ''
                return
            }
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

# Everything Courier put on this PC: the desktop app and its data, the older
# agent and its task, and the courier command. The setup window's Remove
# runs this too.
function Remove-Courier {
    Write-Step 'Removing Courier...'

    Remove-Desktop

    # The desktop app's own data (its stops, history and, on a PC that never
    # had the agent, its pairing code), under Electron's userData folder.
    $appData = Join-Path $env:APPDATA 'Courier'
    if ((Test-Path (Join-Path $appData 'stops.json')) -or (Test-Path (Join-Path $appData 'config.json'))) {
        Remove-Item $appData -Recurse -Force -ErrorAction SilentlyContinue
        Write-Dim "deleted $appData"
    }

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
}

function Invoke-Uninstall {
    Write-Banner
    Remove-Courier

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

# ---------------------------------------------------------------- the window --

<#
    The window the one-line command opens on a desktop, made the same way as
    Reveille's: WPF straight from PowerShell, nothing extra to download, and
    nothing left running once it is closed.

    Anything slow (asking GitHub, downloading, installing) runs in one worker
    runspace, so the window keeps painting. The worker is given this script's
    own functions, so the window and the text version run exactly the same
    steps; each Write-Step the worker prints becomes a line of the window's
    log as it happens.

    A first install is three steps: the phone app (a code for the phone's
    camera), installing on this PC, pairing. After that it has three pages:
    This PC, Phone app, Maintenance. -Console gets the text version instead.
    This file stays plain ASCII (see the banner), so the few characters
    beyond it are made with [char].
#>

$script:CvDot = [string][char]0x00B7

# Light: the blues of Courier's own icon. Dark: Midnight, from the app.
$script:CvThemes = @{
    dark = @{
        Bg = '#0E111A'; Side = '#121620'; Panel = '#161B27'; Raised = '#1D2331'; Line = '#283044'
        Ink = '#E8ECF7'; Ink2 = '#98A2BA'; Ink3 = '#646E88'
        Accent = '#5D8BFF'; AccentDeep = '#3D66E0'; AccentPale = '#B9CCFF'; OnFill = '#FFFFFF'
        Moss = '#4FD69A'; Amber = '#E8B15C'; Danger = '#FF6B84'
        MossSoft = '#2E4FD69A'; AmberSoft = '#21E8B15C'; DangerSoft = '#21FF6B84'; AccentSoft = '#1F5D8BFF'; AccentPill = '#2E5D8BFF'
        DoneInk = '#0B1A12'; QrField = '#DCE7FB'; QrInk = '#0B1F45'
    }
    light = @{
        Bg = '#EEF3FC'; Side = '#E3EBF8'; Panel = '#FFFFFF'; Raised = '#F4F7FD'; Line = '#D2DCEF'
        Ink = '#15284F'; Ink2 = '#4B5E86'; Ink3 = '#8494B2'
        Accent = '#2F6FD8'; AccentDeep = '#2257B5'; AccentPale = '#BFD3F7'; OnFill = '#FFFFFF'
        Moss = '#23875A'; Amber = '#A86A12'; Danger = '#C8364F'
        MossSoft = '#2E23875A'; AmberSoft = '#21A86A12'; DangerSoft = '#21C8364F'; AccentSoft = '#1F2F6FD8'; AccentPill = '#2E2F6FD8'
        DoneInk = '#FFFFFF'; QrField = '#DCE7FB'; QrInk = '#0B1F45'
    }
}

# Line icons on a 24 by 24 grid.
$script:CvIcons = @{
    pc     = 'M4.6,4 H19.4 A1.6,1.6 0 0 1 21,5.6 V14.4 A1.6,1.6 0 0 1 19.4,16 H4.6 A1.6,1.6 0 0 1 3,14.4 V5.6 A1.6,1.6 0 0 1 4.6,4 Z M9,20 H15 M12,16 V20'
    phone  = 'M8.5,2.5 H15.5 A2,2 0 0 1 17.5,4.5 V19.5 A2,2 0 0 1 15.5,21.5 H8.5 A2,2 0 0 1 6.5,19.5 V4.5 A2,2 0 0 1 8.5,2.5 Z M11,18.5 H13'
    maint  = 'M14.7,6.3 A4,4 0 0 0 9.4,11.6 L4,17 L7,20 L12.4,14.6 A4,4 0 0 0 17.7,9.3 L15.3,11.7 L12.7,11.1 L12.1,8.5 Z'
    sun    = 'M8,12 A4,4 0 1 0 16,12 A4,4 0 1 0 8,12 Z M12,2.5 V4.5 M12,19.5 V21.5 M4.6,4.6 L6,6 M18,18 L19.4,19.4 M2.5,12 H4.5 M19.5,12 H21.5 M4.6,19.4 L6,18 M18,6 L19.4,4.6'
    moon   = 'M20,14.5 A8,8 0 1 1 9.5,4 A6.5,6.5 0 0 0 20,14.5 Z'
    update = 'M20,12 A8,8 0 1 1 17.7,6.3 M20,4 V9 H15'
    trash  = 'M4,7 H20 M10,11 V17 M14,11 V17 M6,7 L7,20 H17 L18,7 M9,7 V4 H15 V7'
    check  = 'M5,12.5 L9.5,17 L19,7.5'
    cross  = 'M7,7 L17,17 M17,7 L7,17'
    open   = 'M14,4 H20 V10 M20,4 L11,13 M18,14 V19 A1,1 0 0 1 17,20 H5 A1,1 0 0 1 4,19 V7 A1,1 0 0 1 5,6 H10'
}

# Where a step's line in the log puts the progress bar.
$script:CvProgress = @(
    @('Downloading Courier', 0.12), @('Turning off the older', 0.55), @('Installing it', 0.62),
    @('Opening Courier', 0.95), @('Removing Courier', 0.15), @('Removing the desktop app', 0.4)
)

<#
    The "Get the app" code, for
    https://github.com/Shamilimanuel/Courier/releases/latest/download/courier.apk
    One row per line, 1 for a dark module; made with the qrcode package. That
    link never changes, and on a first install there is nothing yet to draw it.
#>
$script:CvAppQr = @(
    '1111111010001001110001011111101111111'
    '1000001001010110110011110100001000001'
    '1011101010100000010011111010101011101'
    '1011101011010111110000101110101011101'
    '1011101010001110010100101100001011101'
    '1000001011011101111110010011001000001'
    '1111111010101010101010101010101111111'
    '0000000000111001000100111001000000000'
    '0011111100010110010000011000010111101'
    '0110010000100000101111110001001101011'
    '0010011010101011100100111011100101101'
    '1100010111000000000111101011000010100'
    '0001101100001011111111100001011100000'
    '0101110011101110010100101100100010001'
    '1001001100000110010111110111000000000'
    '0111000111000010011110101100001111111'
    '1010101001011111101000000101111110100'
    '0101110001101111000010000010111101001'
    '1100111011000001010000101011010101100'
    '1000000111000100110111000101010001000'
    '1000111111100001010101110000011111111'
    '0110000100110111001101010111001100010'
    '0101011111011011111110001001100110101'
    '1010100011011100110001000100010011011'
    '0011001110001000111010011001101110001'
    '0101110011101010110011101110010010101'
    '0011011111111011101100101011111010011'
    '0111010000100010101110111010100011100'
    '1010101101110000000101111110111110110'
    '0000000000111001110111101010100011011'
    '1111111010101011100110111011101011011'
    '1000001011010111011100110010100010000'
    '1011101010011011101110111010111111011'
    '1011101010001010010001100100110100000'
    '1011101010001000100010001010101010001'
    '1000001001101010111000111011101000101'
    '1111111000111011001100111011001011111'
)

# Courier's icon (app/assets/icon.png at 128 px), carried here as base64,
# since the one-line install is this file and nothing else.
$script:CvLogoPng = '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'

function Get-CvDefaultTheme {
    try {
        $light = Get-ItemPropertyValue 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize' 'AppsUseLightTheme' -ErrorAction Stop
        if ($light -eq 1) { return 'light' }
    } catch { }
    return 'dark'
}

# A window needs a desktop, WPF, and the STA thread WPF runs on --
# powershell.exe 5.1 has one. A scripted or remote run never gets one.
function Test-CvWindowPossible {
    if (-not [Environment]::UserInteractive) { return $false }
    if ($env:SSH_CONNECTION -or $env:SSH_CLIENT) { return $false }
    try { if ([Console]::IsInputRedirected) { return $false } } catch { }
    if (@([Environment]::GetCommandLineArgs() | Where-Object { $_ -match '^-noni' }).Count) { return $false }
    if ([Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA') { return $false }
    try {
        Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

# --------------------------------------------------------------- the worker --

# The functions the worker needs, copied into it from this session. That works
# however this script arrived -- a file, or irm | iex with no file at all.
$script:CvWorkerFunctions = @(
    'Write-Step', 'Write-Ok', 'Write-Warn2', 'Write-Dim',
    'Get-DesktopInstall', 'Get-LatestDesktopRelease', 'Remove-AgentTask', 'Set-CourierCommand',
    'Install-Desktop', 'Remove-Desktop', 'Remove-Courier', 'Stop-WhateverHoldsThePort', 'Read-AgentPort'
)

function Get-CvWorkerSource {
    ($script:CvWorkerFunctions | ForEach-Object {
        "function $_ {`n" + (Get-Item "function:$_").Definition + "`n}"
    }) -join "`n"
}

# Runs in the worker. 'load' sets it up once; every other kind is one job and
# hands back a hashtable as its last output.
$script:CvWorkerScript = {
    param($Kind, $Source, $Vars)
    if ($Kind -eq 'load') {
        foreach ($name in $Vars.Keys) { Set-Variable -Name $name -Value $Vars[$name] -Scope Global }
        . ([scriptblock]::Create($Source))
        return
    }
    $ErrorActionPreference = 'Stop'
    switch ($Kind) {
        'status' {
            $found = Get-DesktopInstall
            $latest = $null
            try { $latest = Get-LatestDesktopRelease } catch { }
            @{
                Installed = [bool]$found
                Version   = $(if ($found) { $found.Version } else { $null })
                Exe       = $(if ($found) { $found.Exe } else { $null })
                Latest    = $(if ($latest) { $latest.Version } else { $null })
                SizeMB    = $(if ($latest) { [Math]::Round($latest.Size / 1MB) } else { $null })
                Running   = [bool](Get-Process -Name 'Courier' -ErrorAction SilentlyContinue)
                OldAgent  = [bool](Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)
                Command   = (Test-Path $CommandFile)
            }
        }
        'install' {
            $found = Install-Desktop
            Write-Step 'Opening Courier...'
            Start-Process $found.Exe -ArgumentList '--show'
            @{ Ok = $true; Version = $found.Version }
        }
        'remove' {
            Remove-Courier
            @{ Ok = -not (Get-DesktopInstall) }
        }
    }
}.ToString()

# Queues a job: @{ Kind; Done = 'function name'; Live = show its log }.
function Add-CvJob {
    param([hashtable]$Job)
    $w = $script:CvWin
    if (-not $w.Runspace) { return }
    if ($Job.Kind -eq 'status' -and (@($w.Queue | Where-Object { $_.Kind -eq 'status' }).Count)) { return }
    [void]$w.Queue.Add($Job)
}

function Start-CvJob {
    param([hashtable]$Job)
    $w = $script:CvWin
    $ps = [powershell]::Create()
    $ps.Runspace = $w.Runspace
    [void]$ps.AddScript($script:CvWorkerScript)
    [void]$ps.AddParameter('Kind', $Job.Kind)
    [void]$ps.AddParameter('Source', $Job.Source)
    [void]$ps.AddParameter('Vars', $Job.Vars)
    $Job.PS = $ps
    $Job.Seen = 0
    $Job.Async = $ps.BeginInvoke()
    $w.Job = $Job
}

# The jobs that change something: closing the window waits for them, and
# their buttons are greyed out while one runs.
function Test-CvBusy {
    $w = $script:CvWin
    if ($w.Job -and $w.Job.Kind -in @('install', 'remove')) { return $true }
    return [bool](@($w.Queue | Where-Object { $_.Kind -in @('install', 'remove') }).Count)
}

# Moves whatever the worker has printed since last time into the log.
function Read-CvLive {
    param([hashtable]$Job)
    $w = $script:CvWin
    $info = $Job.PS.Streams.Information
    $added = $false
    while ($Job.Seen -lt $info.Count) {
        $data = $info[$Job.Seen].MessageData
        $Job.Seen++
        $text = "$data".Trim()
        if (-not $text -or $text -match '[\u2500-\u259f]' -or $text -match '^-+$') { continue }
        $colour = ''
        try { $colour = [string]$data.ForegroundColor } catch { }
        $kind = switch ($colour) { 'Cyan' { 'step' } 'Green' { 'ok' } 'Yellow' { 'warn' } default { 'dim' } }
        foreach ($p in $script:CvProgress) {
            if ($text.StartsWith($p[0])) { $w.Progress = [Math]::Max($w.Progress, $p[1]) }
        }
        [void]$w.Log.Add(@{ Text = $text; Kind = $kind })
        $added = $true
    }
    return $added
}

# The window's timer: shows a running job's progress, hands a finished one
# to its Done function, and starts the next.
function Invoke-CvTick {
    $w = $script:CvWin
    try {
        if ($w.Job) {
            $job = $w.Job
            if ($job.Live -and (Read-CvLive $job)) { Update-CvContent }
            if ($job.Async.IsCompleted) {
                $w.Job = $null
                $out = @()
                $err = $null
                try {
                    $out = @($job.PS.EndInvoke($job.Async))
                } catch {
                    $e = $_.Exception
                    while ($e.InnerException) { $e = $e.InnerException }
                    $err = $e.Message
                }
                if ($job.Live) { [void](Read-CvLive $job) }
                $job.PS.Dispose()
                $result = @($out | Where-Object { $_ -is [hashtable] }) | Select-Object -Last 1
                if ($job.Done) { & $job.Done $job $result $err }
            }
        }
        if (-not $w.Job -and $w.Queue.Count) {
            $next = $w.Queue[0]
            $w.Queue.RemoveAt(0)
            Start-CvJob $next
        }
        if ($w.ToastUntil -and (Get-Date) -ge $w.ToastUntil) {
            $w.ToastUntil = $null
            $w.Window.FindName('Toast').Visibility = 'Collapsed'
        }
    } catch {
        $w.Notice = @{ Kind = 'bad'; Text = "Something went wrong: $($_.Exception.Message)" }
        try { Update-CvContent } catch { }
    }
}

function Request-CvStatus {
    Add-CvJob @{ Kind = 'status'; Done = 'Complete-CvStatus' }
}

# --------------------------------------------------------- building blocks --

function New-CvTh {
    param([double[]]$v)
    switch ($v.Count) {
        1 { return New-Object Windows.Thickness($v[0]) }
        2 { return New-Object Windows.Thickness($v[0], $v[1], $v[0], $v[1]) }
        default { return New-Object Windows.Thickness($v[0], $v[1], $v[2], $v[3]) }
    }
}

# A brush from the theme by name, or a fixed colour written #RRGGBB.
function Set-CvBrush {
    param($Element, $Property, [string]$Value)
    if (-not $Value) { return }
    if ($Value.StartsWith('#')) {
        $Element.SetValue($Property, (New-Object Windows.Media.BrushConverter).ConvertFromString($Value))
    } else {
        $Element.SetResourceReference($Property, $Value)
    }
}

# Wrapping text, with two marks of its own: **bold** and `code`.
function New-CvText {
    param([string]$Text, [double]$Size = 13.5, [string]$Brush = 'Ink', [string]$Weight = '',
          [double[]]$Margin = @(0), [switch]$Mono, [switch]$NoWrap, [double]$MaxWidth = 0)
    $t = New-Object Windows.Controls.TextBlock
    $t.FontSize = $Size
    $t.Margin = New-CvTh $Margin
    if (-not $NoWrap) { $t.TextWrapping = 'Wrap' }
    if ($Weight) { $t.FontWeight = [Windows.FontWeights]::$Weight }
    if ($Mono) { $t.FontFamily = $script:CvMono }
    if ($MaxWidth) { $t.MaxWidth = $MaxWidth; $t.HorizontalAlignment = 'Left' }
    Set-CvBrush $t ([Windows.Controls.TextBlock]::ForegroundProperty) $Brush
    foreach ($part in [regex]::Split([string]$Text, '(\*\*[^*]+\*\*|`[^`]+`)')) {
        if (-not $part) { continue }
        $run = New-Object Windows.Documents.Run
        if ($part -match '^\*\*(.+)\*\*$') {
            $run.Text = $Matches[1]
            $run.FontWeight = [Windows.FontWeights]::SemiBold
            $run.SetResourceReference([Windows.Documents.TextElement]::ForegroundProperty, 'Ink')
        } elseif ($part -match '^`(.+)`$') {
            $run.Text = ' ' + $Matches[1] + ' '
            $run.FontFamily = $script:CvMono
            $run.FontSize = $Size - 1
            $run.SetResourceReference([Windows.Documents.TextElement]::BackgroundProperty, 'Raised')
        } else {
            $run.Text = $part
        }
        [void]$t.Inlines.Add($run)
    }
    return $t
}

# Every button goes through Invoke-CvClick; its Tag says what it is for.
function New-CvButton {
    param([object]$Content, [hashtable]$Tag, [string]$Style = 'CvBtn', [double[]]$Margin = @(0), [switch]$Disabled)
    $b = New-Object Windows.Controls.Button
    $b.Style = $script:CvWin.Window.FindResource($Style)
    $b.Content = $Content
    $b.Tag = $Tag
    $b.Margin = New-CvTh $Margin
    if ($Disabled) { $b.IsEnabled = $false }
    $b.Add_Click({ Invoke-CvClick $this })
    return $b
}

# A line icon. -Brush '' takes the colour of the button it sits in.
function New-CvIcon {
    param([string]$Name, [double]$Size = 18, [string]$Brush = '', [double]$Stroke = 1.8)
    $p = New-Object Windows.Shapes.Path
    $p.Data = [Windows.Media.Geometry]::Parse($script:CvIcons[$Name])
    $p.StrokeThickness = $Stroke
    $p.StrokeStartLineCap = 'Round'
    $p.StrokeEndLineCap = 'Round'
    $p.StrokeLineJoin = 'Round'
    if ($Brush) {
        Set-CvBrush $p ([Windows.Shapes.Shape]::StrokeProperty) $Brush
    } else {
        $bind = New-Object Windows.Data.Binding('Foreground')
        $bind.RelativeSource = New-Object Windows.Data.RelativeSource([Windows.Data.RelativeSourceMode]::FindAncestor, [Windows.Controls.Control], 1)
        [void]$p.SetBinding([Windows.Shapes.Shape]::StrokeProperty, $bind)
    }
    $c = New-Object Windows.Controls.Canvas
    $c.Width = 24
    $c.Height = 24
    [void]$c.Children.Add($p)
    $v = New-Object Windows.Controls.Viewbox
    $v.Width = $Size
    $v.Height = $Size
    $v.Child = $c
    return $v
}

function New-CvBox {
    param($Child, [string]$Bg = 'Panel', [string]$Line = 'Line', [double[]]$Thick = @(1), [double]$Radius = 12,
          [double[]]$Padding = @(16, 14), [double[]]$Margin = @(0))
    $b = New-Object Windows.Controls.Border
    Set-CvBrush $b ([Windows.Controls.Border]::BackgroundProperty) $Bg
    Set-CvBrush $b ([Windows.Controls.Border]::BorderBrushProperty) $Line
    $b.BorderThickness = New-CvTh $Thick
    $b.CornerRadius = New-Object Windows.CornerRadius($Radius)
    $b.Padding = New-CvTh $Padding
    $b.Margin = New-CvTh $Margin
    $b.Child = $Child
    return $b
}

function New-CvStack {
    param([string]$Orientation = 'Vertical', [double[]]$Margin = @(0))
    $s = New-Object Windows.Controls.StackPanel
    $s.Orientation = $Orientation
    $s.Margin = New-CvTh $Margin
    return $s
}

# A grid with the given columns: numbers are pixels, '*' or '2*' share the
# rest, 'auto' fits its content.
function New-CvGrid {
    param([string[]]$Columns, [double[]]$Margin = @(0))
    $g = New-Object Windows.Controls.Grid
    $g.Margin = New-CvTh $Margin
    foreach ($col in $Columns) {
        $def = New-Object Windows.Controls.ColumnDefinition
        if ($col -eq 'auto') { $def.Width = [Windows.GridLength]::Auto }
        elseif ($col -match '^([\d.]*)\*$') {
            $n = if ($Matches[1]) { [double]$Matches[1] } else { 1 }
            $def.Width = New-Object Windows.GridLength($n, [Windows.GridUnitType]::Star)
        } else { $def.Width = New-Object Windows.GridLength([double]$col) }
        $g.ColumnDefinitions.Add($def)
    }
    return $g
}

function Add-CvCell {
    param($Grid, $Child, [int]$Column)
    [Windows.Controls.Grid]::SetColumn($Child, $Column)
    [void]$Grid.Children.Add($Child)
}

# A round step number in the sidebar.
function New-CvDisc {
    param([string]$Text, [string]$Bg, [string]$Fg, [string]$Line = '', [double]$Size = 22)
    $t = New-CvText $Text -Size 11.5 -Brush $Fg -Weight 'Bold' -NoWrap
    $t.HorizontalAlignment = 'Center'
    $t.VerticalAlignment = 'Center'
    $b = New-CvBox $t -Bg $Bg -Line $Line -Thick $(if ($Line) { @(1.5) } else { @(0) }) -Radius ($Size / 2) -Padding @(0)
    $b.Width = $Size
    $b.Height = $Size
    return $b
}

function New-CvPill {
    param([string]$Text, [string]$Kind = 'on')
    switch ($Kind) {
        'on'   { $bg = 'MossSoft'; $fg = 'Moss'; $line = '' }
        'new'  { $bg = 'AccentPill'; $fg = 'Accent'; $line = '' }
        'warn' { $bg = 'AmberSoft'; $fg = 'Amber'; $line = '' }
        default { $bg = 'Raised'; $fg = 'Ink3'; $line = 'Line' }
    }
    $t = New-CvText $Text -Size 11.5 -Brush $fg -Weight 'Bold' -NoWrap
    $b = New-CvBox $t -Bg $bg -Line $line -Thick $(if ($line) { @(1) } else { @(0) }) -Radius 10 -Padding @(9, 2)
    $b.VerticalAlignment = 'Center'
    $b.HorizontalAlignment = 'Left'
    return $b
}

<#
    A QR code from its rows of 0 and 1. Each run of dark modules in a row is
    one rectangle, drawn without anti-aliasing so the edges stay sharp, and
    the size is a whole number of pixels per module -- a code a camera reads
    first time rather than eventually.
#>
function New-CvQr {
    param([string[]]$Rows, [double]$Size = 210)
    $n = $Rows.Count
    $total = $n + 8
    $Size = [Math]::Max(3, [Math]::Floor($Size / $total)) * $total
    $sb = New-Object Text.StringBuilder
    for ($y = 0; $y -lt $n; $y++) {
        $row = $Rows[$y]
        $x = 0
        while ($x -lt $n) {
            if ($row[$x] -eq [char]'1') {
                $start = $x
                while ($x -lt $n -and $row[$x] -eq [char]'1') { $x++ }
                [void]$sb.AppendFormat('M{0},{1}h{2}v1h-{2}z', ($start + 4), ($y + 4), ($x - $start))
            } else {
                $x++
            }
        }
    }
    $path = New-Object Windows.Shapes.Path
    $path.Data = [Windows.Media.Geometry]::Parse($sb.ToString())
    Set-CvBrush $path ([Windows.Shapes.Shape]::FillProperty) 'QrInk'
    [Windows.Media.RenderOptions]::SetEdgeMode($path, [Windows.Media.EdgeMode]::Aliased)
    $canvas = New-Object Windows.Controls.Canvas
    $canvas.Width = $total
    $canvas.Height = $total
    [void]$canvas.Children.Add($path)
    $view = New-Object Windows.Controls.Viewbox
    $view.Child = $canvas
    $box = New-CvBox $view -Bg 'QrField' -Line '' -Thick @(0) -Radius 10 -Padding @(0)
    $box.Width = $Size
    $box.Height = $Size
    $box.VerticalAlignment = 'Top'
    return $box
}

function Get-CvLogoBitmap {
    if ($script:CvLogoBitmap) { return $script:CvLogoBitmap }
    $bytes = [Convert]::FromBase64String($script:CvLogoPng)
    $image = New-Object Windows.Media.Imaging.BitmapImage
    $image.BeginInit()
    $image.StreamSource = New-Object IO.MemoryStream(, $bytes)
    $image.CacheOption = [Windows.Media.Imaging.BitmapCacheOption]::OnLoad
    $image.EndInit()
    $image.Freeze()
    $script:CvLogoBitmap = $image
    return $image
}

# The icon with rounded corners, the way a launcher shows it.
function New-CvLogo {
    param([double]$Size = 34, [double]$Radius = 9)
    $brush = New-Object Windows.Media.ImageBrush (Get-CvLogoBitmap)
    $brush.Stretch = 'UniformToFill'
    $box = New-Object Windows.Controls.Border
    $box.Width = $Size
    $box.Height = $Size
    $box.CornerRadius = New-Object Windows.CornerRadius($Radius)
    $box.Background = $brush
    return $box
}

function Show-CvToast {
    param([string]$Text)
    $w = $script:CvWin
    $w.Window.FindName('ToastText').Text = $Text
    $w.Window.FindName('Toast').Visibility = 'Visible'
    $w.ToastUntil = (Get-Date).AddMilliseconds(1800)
}

# ------------------------------------------------------------------ painting --

function Set-CvTheme {
    param([string]$Name)
    $w = $script:CvWin
    $w.Theme = $Name
    $converter = New-Object Windows.Media.BrushConverter
    foreach ($key in $script:CvThemes[$Name].Keys) {
        $w.Window.Resources[$key] = $converter.ConvertFromString($script:CvThemes[$Name][$key])
    }
    $from = [Windows.Media.ColorConverter]::ConvertFromString($script:CvThemes[$Name].Accent)
    $to = [Windows.Media.ColorConverter]::ConvertFromString($script:CvThemes[$Name].AccentPale)
    # ::new, not New-Object: a resource must be the brush itself, and
    # New-Object hands back PowerShell's wrapper around it.
    $w.Window.Resources['Progress'] = [Windows.Media.LinearGradientBrush]::new([Windows.Media.Color]$from, [Windows.Media.Color]$to, 0.0)
    Set-CvTitleBar
}

# Windows draws the title bar itself; this asks it for the dark one to match.
function Set-CvTitleBar {
    $w = $script:CvWin
    if (-not $w.Hwnd) { return }
    try {
        if (-not ('Courier.Dwm' -as [type])) {
            Add-Type -Namespace Courier -Name Dwm -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("dwmapi.dll")]
public static extern int DwmSetWindowAttribute(System.IntPtr hwnd, int attribute, ref int value, int size);
'@
        }
        $dark = [int]($w.Theme -eq 'dark')
        [void][Courier.Dwm]::DwmSetWindowAttribute($w.Hwnd, 20, [ref]$dark, 4)
    } catch { }
}

function Update-CvAll {
    Update-CvSide
    Update-CvContent
}

$script:CvSteps = @('Get the phone app', 'Install on this PC', 'Pair your phone')
$script:CvViews = @(@('pc', 'This PC'), @('phone', 'Phone app'), @('maint', 'Maintenance'))

function Update-CvSide {
    $w = $script:CvWin
    $win = $w.Window
    $win.FindName('BrandSub').Text = if ($w.Mode -eq 'first') { 'First install' } else { 'Setup' }

    $panel = $win.FindName('SideMain')
    $panel.Children.Clear()
    if ($w.Mode -eq 'installed') {
        foreach ($v in $script:CvViews) {
            $row = New-Object Windows.Controls.DockPanel
            $icon = New-CvIcon $v[0] -Size 18
            $icon.Margin = New-CvTh @(0, 0, 11, 0)
            [Windows.Controls.DockPanel]::SetDock($icon, 'Left')
            [void]$row.Children.Add($icon)
            if ($v[0] -eq 'maint' -and $w.Status -and $w.Status.Latest -and $w.Status.Version -and $w.Status.Latest -ne $w.Status.Version) {
                $badge = New-CvBox (New-CvText '1' -Size 10.5 -Brush 'OnFill' -Weight 'Bold' -NoWrap) -Bg 'Accent' -Line '' -Thick @(0) -Radius 9 -Padding @(7, 0)
                $badge.VerticalAlignment = 'Center'
                [Windows.Controls.DockPanel]::SetDock($badge, 'Right')
                [void]$row.Children.Add($badge)
            }
            $label = New-CvText $v[1] -Size 13.5 -Brush '' -Weight 'SemiBold' -NoWrap
            $label.VerticalAlignment = 'Center'
            [void]$row.Children.Add($label)
            $style = if ($w.View -eq $v[0]) { 'CvNavOn' } else { 'CvNav' }
            [void]$panel.Children.Add((New-CvButton $row @{ Do = 'view'; View = $v[0] } $style))
        }
    } else {
        for ($i = 1; $i -le 3; $i++) {
            $row = New-CvGrid @('22', '*')
            $now = $i -eq $w.Step
            $done = $i -lt $w.Step
            $disc = if ($done) { New-CvDisc "$i" -Bg 'Moss' -Fg 'DoneInk' }
                    elseif ($now) { New-CvDisc "$i" -Bg '' -Fg 'Accent' -Line 'Accent' }
                    else { New-CvDisc "$i" -Bg '' -Fg 'Ink3' -Line 'Line' }
            Add-CvCell $row $disc 0
            $brush = if ($now) { 'Ink' } elseif ($done) { 'Ink2' } else { 'Ink3' }
            $label = New-CvText $script:CvSteps[$i - 1] -Size 13.5 -Brush $brush -Weight 'SemiBold' -Margin @(10, 0, 0, 0)
            $label.VerticalAlignment = 'Center'
            Add-CvCell $row $label 1
            [void]$panel.Children.Add((New-CvBox $row -Bg $(if ($now) { 'Raised' } else { '' }) -Line '' -Thick @(0) -Radius 8 -Padding @(8, 8) -Margin @(0, 0, 0, 4)))
        }
    }

    # Whether Courier runs, and the theme, at the bottom.
    $dot = $win.FindName('StateDot')
    $text = $win.FindName('StateText')
    $s = $w.Status
    if (-not $s) { $fill = 'Ink3'; $text.Text = 'Looking...' }
    elseif (-not $s.Installed) { $fill = 'Ink3'; $text.Text = 'Not installed yet' }
    elseif ($s.Running) { $fill = 'Moss'; $text.Text = "Courier $($s.Version) is running" }
    else { $fill = 'Amber'; $text.Text = "Courier $($s.Version) is not running" }
    Set-CvBrush $dot ([Windows.Shapes.Shape]::FillProperty) $fill
    $theme = $win.FindName('ThemeBtn')
    $theme.Content = New-CvIcon $(if ($w.Theme -eq 'dark') { 'sun' } else { 'moon' }) -Size 15
    $theme.ToolTip = 'Light or dark'
}

function Update-CvContent {
    $w = $script:CvWin
    $panel = $w.Window.FindName('Content')
    $panel.Children.Clear()
    if ($w.Mode -eq 'first') { Add-CvStepView $panel }
    else {
        switch ($w.View) {
            'pc'    { Add-CvPcView $panel }
            'phone' { Add-CvPhoneView $panel }
            'maint' { Add-CvMaintView $panel }
        }
    }
}

function Add-CvHeader {
    param($Panel, [string]$Heading, [string]$Sub)
    [void]$Panel.Children.Add((New-CvText $Heading -Size 22 -Weight 'Bold' -Margin @(0, 0, 0, 4)))
    [void]$Panel.Children.Add((New-CvText $Sub -Size 13.5 -Brush 'Ink2' -Margin @(0, 0, 0, 20) -MaxWidth 620))
    $w = $script:CvWin
    if ($w.Notice) { [void]$Panel.Children.Add((New-CvNote $w.Notice.Text $w.Notice.Kind)) }
}

function New-CvNote {
    param([string]$Text, [string]$Kind = 'info', [double[]]$Margin = @(0, 0, 0, 16))
    switch ($Kind) {
        'ok'   { $bg = 'MossSoft'; $fg = 'Moss' }
        'warn' { $bg = 'AmberSoft'; $fg = 'Amber' }
        'bad'  { $bg = 'DangerSoft'; $fg = 'Danger' }
        default { $bg = 'AccentSoft'; $fg = 'Ink2' }
    }
    $note = New-CvBox (New-CvText $Text -Size 12.5 -Brush $fg) -Bg $bg -Line '' -Thick @(0) -Radius 10 -Padding @(14, 11) -Margin $Margin
    return $note
}

function New-CvRow {
    param([object[]]$Children, [double[]]$Margin = @(0, 16, 0, 0))
    $row = New-CvStack 'Horizontal' -Margin $Margin
    foreach ($c in $Children) { if ($c) { $c.Margin = New-CvTh @(0, 0, 8, 0); [void]$row.Children.Add($c) } }
    return $row
}

# The progress bar and the last lines the worker printed.
function Add-CvLog {
    param($Panel)
    $w = $script:CvWin
    $track = New-Object Windows.Controls.Grid
    $track.Height = 8
    $track.HorizontalAlignment = 'Stretch'
    $bgBar = New-CvBox $null -Bg 'Raised' -Line 'Line' -Thick @(1) -Radius 4 -Padding @(0)
    [void]$track.Children.Add($bgBar)
    $fill = New-Object Windows.Controls.Border
    $fill.CornerRadius = New-Object Windows.CornerRadius(4)
    $fill.SetResourceReference([Windows.Controls.Border]::BackgroundProperty, 'Progress')
    $fill.HorizontalAlignment = 'Left'
    [void]$track.Children.Add($fill)
    $track.Add_SizeChanged({ $this.Children[1].Width = [Math]::Max(0, $this.ActualWidth * $script:CvWin.Progress) })
    $fill.Width = 0
    [void]$Panel.Children.Add((New-CvBox $track -Bg '' -Line '' -Thick @(0) -Radius 0 -Padding @(0) -Margin @(0, 0, 0, 12)))

    $lines = New-CvStack
    $recent = @($w.Log | Select-Object -Last 9)
    if (-not $recent.Count) { [void]$lines.Children.Add((New-CvText 'Starting...' -Size 12.5 -Brush 'Ink3' -Mono)) }
    foreach ($l in $recent) {
        $brush = switch ($l.Kind) { 'step' { 'Ink' } 'ok' { 'Moss' } 'warn' { 'Amber' } default { 'Ink3' } }
        [void]$lines.Children.Add((New-CvText $l.Text -Size 12.5 -Brush $brush -Mono -Margin @(0, 0, 0, 3)))
    }
    $box = New-CvBox $lines -Bg 'Panel' -Radius 12 -Padding @(16, 12) -Margin @(0, 0, 0, 14)
    [void]$Panel.Children.Add($box)
}

# A list of facts: an icon, a name, and a detail on the right.
function New-CvFacts {
    param([object[]]$Rows)
    $list = New-CvStack
    for ($i = 0; $i -lt $Rows.Count; $i++) {
        $r = $Rows[$i]
        $grid = New-CvGrid @('24', 'auto', '*')
        switch -Regex ($r[0]) {
            '^\d$' { $icon = New-CvDisc $r[0] -Bg '' -Fg 'Accent' -Line 'Accent' -Size 20 }
            '^ok$'   { $icon = New-CvIcon 'check' -Size 16 -Brush 'Moss' -Stroke 2.2 }
            '^bad$'  { $icon = New-CvIcon 'cross' -Size 16 -Brush 'Danger' -Stroke 2.2 }
            '^warn$' { $icon = New-CvIcon 'check' -Size 16 -Brush 'Amber' -Stroke 2.2 }
            '^info$' { $icon = New-CvIcon 'check' -Size 16 -Brush 'Accent' -Stroke 2.2 }
        }
        $icon.VerticalAlignment = 'Top'
        $icon.Margin = New-CvTh @(0, 1, 0, 0)
        Add-CvCell $grid $icon 0
        Add-CvCell $grid (New-CvText $r[1] -Size 13.5 -Margin @(10, 0, 14, 0) -NoWrap) 1
        $detail = $r[2]
        if ($detail -is [string]) {
            $detail = New-CvText $detail -Size 12.5 -Brush $(if ($r[0] -eq 'bad') { 'Danger' } else { 'Ink3' })
            $detail.TextAlignment = 'Right'
        }
        $detail.HorizontalAlignment = 'Right'
        Add-CvCell $grid $detail 2
        $last = $i -eq $Rows.Count - 1
        [void]$list.Children.Add((New-CvBox $grid -Bg '' -Line 'Line' -Thick $(if ($last) { @(0) } else { @(0, 0, 0, 1) }) -Radius 0 -Padding @(16, 12)))
    }
    $box = New-CvBox $list -Radius 12 -Padding @(0)
    return $box
}

# The phone app's download code, with what to do with it.
function New-CvAppCard {
    param([string]$Aside)
    $grid = New-CvGrid @('auto', '*')
    Add-CvCell $grid (New-CvQr $script:CvAppQr -Size 210) 0
    $text = New-CvStack -Margin @(22, 2, 0, 0)
    [void]$text.Children.Add((New-CvText 'Courier for Android' -Size 16 -Weight 'Bold' -Margin @(0, 0, 0, 6)))
    [void]$text.Children.Add((New-CvText 'Point the phone''s own camera at it. It downloads the newest Courier, so this code never goes out of date.' -Brush 'Ink2' -Margin @(0, 0, 0, 10)))
    [void]$text.Children.Add((New-CvText 'Installing it, Android may ask to allow apps from your browser. That is normal for an app from outside the Play Store.' -Size 12.5 -Brush 'Ink3' -Margin @(0, 0, 0, 10)))
    if ($Aside) { [void]$text.Children.Add((New-CvText $Aside -Size 12.5 -Brush 'Ink3')) }
    Add-CvCell $grid $text 1
    $card = New-CvBox $grid -Radius 14 -Padding @(20, 20)
    return $card
}

# ----------------------------------------------------------------- the pages --

function Add-CvStepView {
    param($Panel)
    $w = $script:CvWin
    $s = $w.Status
    switch ($w.Step) {
        1 {
            Add-CvHeader $Panel 'Get Courier on your phone' 'First the phone app, so it can download while this PC installs. Courier sends text, your clipboard and files between your phone and your PCs, over your own Wi-Fi.'
            [void]$Panel.Children.Add((New-CvAppCard 'Already have the app? Go on to 2.'))
            [void]$Panel.Children.Add((New-CvRow @((New-CvButton 'Next' @{ Do = 'step'; Step = 2 } 'CvPrimary'))))
        }
        2 {
            $state = $w.Install
            if ($state -eq 'idle') {
                Add-CvHeader $Panel 'Install Courier on this PC' 'The desktop app: a window to send from this PC, and a tray icon that receives. It starts with Windows, quietly.'
                $size = if ($s -and $s.SizeMB) { "$($s.SizeMB) MB from GitHub" } else { 'from GitHub' }
                $version = if ($s -and $s.Latest) { "Courier $($s.Latest)" } else { 'The newest Courier' }
                $rows = @(
                    , @('ok', $version, $size)
                    , @('ok', 'Just for you', 'No administrator needed')
                    , @('ok', 'The courier command', 'Type it to open the window')
                )
                if ($s -and $s.OldAgent) { $rows += , @('info', 'Your older Courier', 'Replaced; phones stay paired') }
                [void]$Panel.Children.Add((New-CvFacts $rows))
                [void]$Panel.Children.Add((New-CvRow @((New-CvButton 'Back' @{ Do = 'step'; Step = 1 }),
                                                       (New-CvButton 'Install' @{ Do = 'install' } 'CvPrimary' -Disabled:(-not $s)))))
            } else {
                Add-CvHeader $Panel 'Installing Courier' 'It downloads, installs just for you and opens. This takes a minute.'
                Add-CvLog $Panel
                if ($state -eq 'done') {
                    [void]$Panel.Children.Add((New-CvNote 'Done. Courier is open on this PC, and in the tray next to the clock.' 'ok' -Margin @(0)))
                    [void]$Panel.Children.Add((New-CvRow @((New-CvButton 'Next' @{ Do = 'step'; Step = 3 } 'CvPrimary'))))
                } elseif ($state -eq 'failed') {
                    [void]$Panel.Children.Add((New-CvNote $w.InstallError 'bad' -Margin @(0)))
                    [void]$Panel.Children.Add((New-CvRow @((New-CvButton 'Back' @{ Do = 'step'; Step = 1 }),
                                                           (New-CvButton 'Try again' @{ Do = 'install' } 'CvPrimary'))))
                }
            }
        }
        3 {
            Add-CvHeader $Panel 'Pair your phone' 'One scan, and the phone knows where this PC is. Nothing to type.'
            $steps = @(
                , @('1', 'In the Courier window', 'Open **Pair**: it shows this PC''s code')
                , @('2', 'On the phone', 'Courier, **+ Add a stop**, scan that code')
                , @('3', 'If Windows asks about the network', 'Allow it for **private networks**')
            )
            [void]$Panel.Children.Add((New-CvFacts $steps))
            [void]$Panel.Children.Add((New-CvNote 'From now on, type `courier` in PowerShell, cmd or Win+R to open Courier, and `courier -Setup` for this window.' 'info' -Margin @(0, 16, 0, 0)))
            [void]$Panel.Children.Add((New-CvRow @((New-CvButton 'Open Courier' @{ Do = 'open' }),
                                                   (New-CvButton 'Finish' @{ Do = 'finish' } 'CvPrimary'))))
        }
    }
}

function Add-CvPcView {
    param($Panel)
    $w = $script:CvWin
    $s = $w.Status
    Add-CvHeader $Panel 'Courier on this PC' 'What is installed, whether it runs, and whether it is up to date.'
    if (-not $s) { [void]$Panel.Children.Add((New-CvText 'Looking...' -Brush 'Ink2')); return }
    $newer = $s.Latest -and $s.Version -and $s.Latest -ne $s.Version
    $rows = @(
        , @($(if ($s.Running) { 'ok' } else { 'warn' }), "Courier Desktop $($s.Version)", (New-CvPill $(if ($s.Running) { 'Running' } else { 'Not running' }) $(if ($s.Running) { 'on' } else { 'warn' })))
        , @($(if ($newer) { 'info' } else { 'ok' }), 'Newest on GitHub', (New-CvPill $(if (-not $s.Latest) { 'Could not check' } elseif ($newer) { "$($s.Latest) is out" } else { 'Up to date' }) $(if ($newer) { 'new' } elseif ($s.Latest) { 'on' } else { 'off' })))
        , @('ok', 'Starts with Windows', 'In the tray, next to the clock')
        , @($(if ($s.Command) { 'ok' } else { 'warn' }), 'The courier command', $(if ($s.Command) { 'Type it to open the window' } else { 'Missing: Repair adds it' }))
    )
    [void]$Panel.Children.Add((New-CvFacts $rows))
    $buttons = @((New-CvButton 'Open Courier' @{ Do = 'open' } 'CvPrimary'))
    if ($newer) { $buttons += New-CvButton "Update to $($s.Latest)" @{ Do = 'install' } -Disabled:(Test-CvBusy) }
    $buttons += New-CvButton 'Refresh' @{ Do = 'refresh' }
    [void]$Panel.Children.Add((New-CvRow $buttons))
}

function Add-CvPhoneView {
    param($Panel)
    Add-CvHeader $Panel 'Courier on your phone' 'The Android app. Pair it under **Pair** in the Courier window on this PC.'
    [void]$Panel.Children.Add((New-CvAppCard ''))
}

# One maintenance action: an icon, what it does, and its button. A confirm
# replaces the button with a question and two answers.
function New-CvMaintRow {
    param([string]$Icon, [string]$Heading, [string]$Desc, $Button, [string]$Ask = '', [hashtable]$YesTag = $null, [string]$YesText = '')
    $grid = New-CvGrid @('40', '*', 'auto')
    $ic = New-CvIcon $Icon -Size 20 -Brush 'Ink2'
    $ic.VerticalAlignment = 'Top'
    $ic.Margin = New-CvTh @(0, 2, 0, 0)
    Add-CvCell $grid $ic 0
    $text = New-CvStack
    [void]$text.Children.Add((New-CvText $Heading -Size 14.5 -Weight 'SemiBold' -Margin @(0, 0, 0, 3)))
    [void]$text.Children.Add((New-CvText $Desc -Size 12.5 -Brush 'Ink2'))
    if ($Ask) {
        [void]$text.Children.Add((New-CvText $Ask -Size 12.5 -Brush 'Danger' -Weight 'SemiBold' -Margin @(0, 10, 0, 0)))
        [void]$text.Children.Add((New-CvRow @((New-CvButton 'Keep it' @{ Do = 'confirm'; What = $null }),
                                               (New-CvButton $YesText $YesTag 'CvDangerSolid')) -Margin @(0, 8, 0, 0)))
    }
    Add-CvCell $grid $text 1
    $Button.VerticalAlignment = 'Top'
    $Button.Margin = New-CvTh @(14, 0, 0, 0)
    Add-CvCell $grid $Button 2
    $box = New-CvBox $grid -Radius 12 -Padding @(18, 16) -Margin @(0, 0, 0, 10)
    return $box
}

function Add-CvMaintView {
    param($Panel)
    $w = $script:CvWin
    $s = $w.Status
    Add-CvHeader $Panel 'Maintenance' 'Update, repair or remove Courier on this PC. Your phones stay paired through an update or a repair.'
    if ($w.Working) {
        [void]$Panel.Children.Add((New-CvText $w.Working -Size 15 -Weight 'SemiBold' -Margin @(0, 0, 0, 8)))
        Add-CvLog $Panel
    }
    $busy = Test-CvBusy
    $newer = $s -and $s.Latest -and $s.Version -and $s.Latest -ne $s.Version
    $updDesc = if ($newer) { "Courier $($s.Latest) is out; this PC has $($s.Version)." } elseif ($s -and $s.Latest) { 'This PC already has the newest version.' } else { 'Downloads the newest version and installs it over this one.' }
    [void]$Panel.Children.Add((New-CvMaintRow 'update' 'Update' $updDesc (New-CvButton 'Update' @{ Do = 'install' } $(if ($newer) { 'CvPrimary' } else { 'CvBtn' }) -Disabled:$busy)))
    [void]$Panel.Children.Add((New-CvMaintRow 'maint' 'Repair' 'Installs the same version again, and puts the courier command back. For when something acts up.' (New-CvButton 'Repair' @{ Do = 'install' } 'CvBtn' -Disabled:$busy)))
    $ask = if ($w.Confirm -eq 'remove') { 'Remove Courier from this PC? Phones can no longer reach it until you install it again.' } else { '' }
    [void]$Panel.Children.Add((New-CvMaintRow 'trash' 'Remove Courier' 'Takes the app, the courier command and the pairing code off this PC.' `
        (New-CvButton 'Remove' @{ Do = 'confirm'; What = 'remove' } 'CvDanger' -Disabled:($busy -or $w.Confirm -eq 'remove')) `
        $ask @{ Do = 'remove' } 'Remove'))
    [void]$Panel.Children.Add((New-CvNote 'Type `courier` to open Courier, and `courier -Setup` for this window.' 'info' -Margin @(0, 6, 0, 0)))
}

# ------------------------------------------------------------------ clicking --

function Invoke-CvClick {
    param($Source)
    $w = $script:CvWin
    $tag = $Source.Tag
    if (-not $tag) { return }
    try {
        switch ($tag.Do) {
            'view'    { $w.View = $tag.View; $w.Notice = $null; $w.Confirm = $null; Update-CvAll; $w.Window.FindName('ContentScroll').ScrollToTop() }
            'step'    { $w.Step = $tag.Step; $w.Notice = $null; Update-CvAll }
            'theme'   { Set-CvTheme $(if ($w.Theme -eq 'dark') { 'light' } else { 'dark' }); Update-CvAll }
            'refresh' { Request-CvStatus; Show-CvToast 'Checking...' }
            'confirm' { $w.Confirm = $tag.What; Update-CvContent }
            'open' {
                if ($w.Status -and $w.Status.Exe) { Start-Process $w.Status.Exe -ArgumentList '--show'; Show-CvToast 'Opening Courier...' }
                else { Show-CvToast 'Courier is not installed yet' }
            }
            'finish' { $w.Window.Close() }
            'install' {
                if (Test-CvBusy) { return }
                $w.Log.Clear(); $w.Progress = 0.04; $w.Notice = $null; $w.Confirm = $null
                if ($w.Mode -eq 'first') { $w.Install = 'running' }
                else { $w.Working = 'Installing the newest Courier...'; $w.View = 'maint' }
                Add-CvJob @{ Kind = 'install'; Live = $true; Done = 'Complete-CvInstall' }
                Update-CvAll
            }
            'remove' {
                if (Test-CvBusy) { return }
                $w.Log.Clear(); $w.Progress = 0.04; $w.Confirm = $null; $w.Notice = $null
                $w.Working = 'Removing Courier...'
                Add-CvJob @{ Kind = 'remove'; Live = $true; Done = 'Complete-CvRemove' }
                Update-CvAll
            }
        }
    } catch {
        $w.Notice = @{ Kind = 'bad'; Text = "Something went wrong: $($_.Exception.Message)" }
        try { Update-CvContent } catch { }
    }
}

# ------------------------------------------------------- when a job finishes --

function Complete-CvLoad {
    param($Job, $Result, $Err)
    if ($Err) { $script:CvWin.Notice = @{ Kind = 'bad'; Text = "The window could not start its helper: $Err" }; Update-CvContent }
}

function Complete-CvStatus {
    param($Job, $Result, $Err)
    $w = $script:CvWin
    if ($Result) { $w.Status = $Result }
    Update-CvAll
}

function Complete-CvInstall {
    param($Job, $Result, $Err)
    $w = $script:CvWin
    $w.Working = $null
    if ($Err -or -not $Result -or -not $Result.Ok) {
        $why = if ($Err) { $Err } else { 'The installer did not finish.' }
        $msg = "That did not work: $why Check the internet connection and try again."
        if ($w.Mode -eq 'first') { $w.Install = 'failed'; $w.InstallError = $msg }
        else { $w.Notice = @{ Kind = 'bad'; Text = $msg } }
    } else {
        $w.Progress = 1
        if ($w.Mode -eq 'first') { $w.Install = 'done' }
        else { $w.Notice = @{ Kind = 'ok'; Text = "Done. Courier $($Result.Version) is installed and open." } }
    }
    Request-CvStatus
    Update-CvAll
}

function Complete-CvRemove {
    param($Job, $Result, $Err)
    $w = $script:CvWin
    $w.Working = $null
    if ($Err -or -not $Result -or -not $Result.Ok) {
        $w.Notice = @{ Kind = 'bad'; Text = "Courier could not be removed completely: $(if ($Err) { $Err } else { 'it is still installed.' })" }
    } else {
        $w.Mode = 'first'; $w.Step = 1; $w.Install = 'idle'
        $w.Notice = @{ Kind = 'ok'; Text = 'Courier was removed from this PC. To put it back, follow the steps again.' }
    }
    Request-CvStatus
    Update-CvAll
}

# ------------------------------------------------------------ window layout --

function New-CvWindowXaml {
    @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Courier setup" Width="980" Height="680" MinWidth="820" MinHeight="520"
        WindowStartupLocation="CenterScreen" FontFamily="Segoe UI" FontSize="13.5"
        Background="{DynamicResource Bg}" Foreground="{DynamicResource Ink}"
        UseLayoutRounding="True" SnapsToDevicePixels="True">
  <Window.Resources>
    <SolidColorBrush x:Key="Bg" Color="#0E111A"/>
    <SolidColorBrush x:Key="Side" Color="#121620"/>
    <SolidColorBrush x:Key="Panel" Color="#161B27"/>
    <SolidColorBrush x:Key="Raised" Color="#1D2331"/>
    <SolidColorBrush x:Key="Line" Color="#283044"/>
    <SolidColorBrush x:Key="Ink" Color="#E8ECF7"/>
    <SolidColorBrush x:Key="Ink2" Color="#98A2BA"/>
    <SolidColorBrush x:Key="Ink3" Color="#646E88"/>
    <SolidColorBrush x:Key="Accent" Color="#5D8BFF"/>
    <SolidColorBrush x:Key="AccentDeep" Color="#3D66E0"/>
    <SolidColorBrush x:Key="OnFill" Color="#FFFFFF"/>
    <SolidColorBrush x:Key="Danger" Color="#FF6B84"/>

    <ControlTemplate x:Key="CvRounded" TargetType="{x:Type ButtonBase}">
      <Border x:Name="Box" Background="{TemplateBinding Background}" BorderBrush="{TemplateBinding BorderBrush}"
              BorderThickness="{TemplateBinding BorderThickness}" CornerRadius="8" Padding="{TemplateBinding Padding}">
        <ContentPresenter HorizontalAlignment="{TemplateBinding HorizontalContentAlignment}" VerticalAlignment="Center" RecognizesAccessKey="False"/>
      </Border>
      <ControlTemplate.Triggers>
        <Trigger Property="IsEnabled" Value="False"><Setter Property="Opacity" Value="0.45"/></Trigger>
      </ControlTemplate.Triggers>
    </ControlTemplate>

    <Style x:Key="CvBtn" TargetType="{x:Type Button}">
      <Setter Property="Template" Value="{StaticResource CvRounded}"/>
      <Setter Property="Background" Value="{DynamicResource Raised}"/>
      <Setter Property="BorderBrush" Value="{DynamicResource Line}"/>
      <Setter Property="BorderThickness" Value="1"/>
      <Setter Property="Foreground" Value="{DynamicResource Ink}"/>
      <Setter Property="FontWeight" Value="SemiBold"/>
      <Setter Property="Padding" Value="16,8"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="FocusVisualStyle" Value="{x:Null}"/>
      <Setter Property="HorizontalContentAlignment" Value="Center"/>
      <Style.Triggers>
        <Trigger Property="IsMouseOver" Value="True"><Setter Property="BorderBrush" Value="{DynamicResource Ink3}"/></Trigger>
        <Trigger Property="IsKeyboardFocused" Value="True"><Setter Property="BorderBrush" Value="{DynamicResource Accent}"/></Trigger>
      </Style.Triggers>
    </Style>
    <Style x:Key="CvPrimary" TargetType="{x:Type Button}" BasedOn="{StaticResource CvBtn}">
      <Setter Property="Background" Value="{DynamicResource Accent}"/>
      <Setter Property="BorderBrush" Value="{DynamicResource Accent}"/>
      <Setter Property="Foreground" Value="{DynamicResource OnFill}"/>
      <Style.Triggers>
        <Trigger Property="IsMouseOver" Value="True">
          <Setter Property="Background" Value="{DynamicResource AccentDeep}"/>
          <Setter Property="BorderBrush" Value="{DynamicResource AccentDeep}"/>
        </Trigger>
      </Style.Triggers>
    </Style>
    <Style x:Key="CvDanger" TargetType="{x:Type Button}" BasedOn="{StaticResource CvBtn}">
      <Setter Property="Foreground" Value="{DynamicResource Danger}"/>
    </Style>
    <Style x:Key="CvDangerSolid" TargetType="{x:Type Button}" BasedOn="{StaticResource CvBtn}">
      <Setter Property="Background" Value="{DynamicResource Danger}"/>
      <Setter Property="BorderBrush" Value="{DynamicResource Danger}"/>
      <Setter Property="Foreground" Value="#FFFFFF"/>
    </Style>
    <Style x:Key="CvNav" TargetType="{x:Type Button}" BasedOn="{StaticResource CvBtn}">
      <Setter Property="Background" Value="Transparent"/>
      <Setter Property="BorderBrush" Value="Transparent"/>
      <Setter Property="BorderThickness" Value="3,0,0,0"/>
      <Setter Property="Foreground" Value="{DynamicResource Ink2}"/>
      <Setter Property="Padding" Value="8,9,10,9"/>
      <Setter Property="Margin" Value="0,0,0,2"/>
      <Setter Property="HorizontalContentAlignment" Value="Stretch"/>
      <Style.Triggers>
        <Trigger Property="IsMouseOver" Value="True">
          <Setter Property="Background" Value="{DynamicResource Raised}"/>
          <Setter Property="Foreground" Value="{DynamicResource Ink}"/>
          <Setter Property="BorderBrush" Value="Transparent"/>
        </Trigger>
      </Style.Triggers>
    </Style>
    <Style x:Key="CvNavOn" TargetType="{x:Type Button}" BasedOn="{StaticResource CvNav}">
      <Setter Property="Background" Value="{DynamicResource Raised}"/>
      <Setter Property="Foreground" Value="{DynamicResource Ink}"/>
      <Setter Property="BorderBrush" Value="{DynamicResource Accent}"/>
      <Style.Triggers>
        <Trigger Property="IsMouseOver" Value="True"><Setter Property="BorderBrush" Value="{DynamicResource Accent}"/></Trigger>
      </Style.Triggers>
    </Style>
    <Style x:Key="CvIconBtn" TargetType="{x:Type Button}" BasedOn="{StaticResource CvBtn}">
      <Setter Property="Background" Value="Transparent"/>
      <Setter Property="Foreground" Value="{DynamicResource Ink2}"/>
      <Setter Property="Padding" Value="7,4"/>
    </Style>
    <Style TargetType="{x:Type ScrollBar}">
      <Setter Property="Width" Value="12"/>
      <Setter Property="MinWidth" Value="12"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="{x:Type ScrollBar}">
            <Track x:Name="PART_Track" IsDirectionReversed="True" Margin="3,4">
              <Track.Thumb>
                <Thumb>
                  <Thumb.Template>
                    <ControlTemplate TargetType="{x:Type Thumb}">
                      <Border CornerRadius="3" Background="{DynamicResource Line}"/>
                    </ControlTemplate>
                  </Thumb.Template>
                </Thumb>
              </Track.Thumb>
            </Track>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
  </Window.Resources>

  <Grid Background="{DynamicResource Bg}">
    <Grid.ColumnDefinitions>
      <ColumnDefinition Width="228"/>
      <ColumnDefinition Width="*"/>
    </Grid.ColumnDefinitions>

    <Border Background="{DynamicResource Side}" BorderBrush="{DynamicResource Line}" BorderThickness="0,0,1,0">
      <DockPanel Margin="12,16,12,12">
        <StackPanel DockPanel.Dock="Top" Orientation="Horizontal" Margin="6,2,6,18">
          <ContentControl x:Name="Logo" Width="34" Height="34" VerticalAlignment="Center"/>
          <StackPanel Margin="10,0,0,0" VerticalAlignment="Center">
            <TextBlock Text="Courier" FontSize="15" FontWeight="Bold"/>
            <TextBlock x:Name="BrandSub" FontSize="11.5" Foreground="{DynamicResource Ink3}"/>
          </StackPanel>
        </StackPanel>
        <Border DockPanel.Dock="Bottom" BorderBrush="{DynamicResource Line}" BorderThickness="0,1,0,0" Padding="0,14,0,0">
          <DockPanel Margin="6,0,0,0">
            <Button x:Name="ThemeBtn" DockPanel.Dock="Right" Style="{StaticResource CvIconBtn}"/>
            <Ellipse x:Name="StateDot" Width="8" Height="8" VerticalAlignment="Center" Margin="0,0,8,0"/>
            <TextBlock x:Name="StateText" FontSize="12" Foreground="{DynamicResource Ink2}" TextWrapping="Wrap" VerticalAlignment="Center"/>
          </DockPanel>
        </Border>
        <ScrollViewer VerticalScrollBarVisibility="Auto"><StackPanel x:Name="SideMain"/></ScrollViewer>
      </DockPanel>
    </Border>

    <Grid Grid.Column="1">
      <ScrollViewer x:Name="ContentScroll" VerticalScrollBarVisibility="Auto">
        <Grid>
          <Grid.ColumnDefinitions><ColumnDefinition Width="*" MaxWidth="760"/></Grid.ColumnDefinitions>
          <StackPanel x:Name="Content" Margin="30,26,30,30"/>
        </Grid>
      </ScrollViewer>
      <Border x:Name="Toast" Visibility="Collapsed" VerticalAlignment="Bottom" HorizontalAlignment="Center"
              Margin="0,0,0,26" CornerRadius="16" Padding="16,8" Background="{DynamicResource Ink}">
        <TextBlock x:Name="ToastText" FontWeight="SemiBold" Foreground="{DynamicResource Bg}"/>
      </Border>
    </Grid>
  </Grid>
</Window>
"@
}

# ---------------------------------------------------------- opening it all --

<#
    Builds the window and its state without showing it. Show-CvWindow shows
    it; a test can draw it to a picture instead. -NoWorker is for that: no
    background work at all, and the state is the caller's to set.
#>
function New-CvWindow {
    param([switch]$NoWorker)
    Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase
    $script:CvMono = New-Object Windows.Media.FontFamily('Cascadia Mono, Consolas')
    $window = [Windows.Markup.XamlReader]::Parse((New-CvWindowXaml))

    $installed = [bool](Get-DesktopInstall)
    $script:CvWin = @{
        Window = $window; Theme = 'dark'; Hwnd = $null
        Mode = $(if ($installed) { 'installed' } else { 'first' }); View = 'pc'; Step = 1
        Install = 'idle'; InstallError = $null; Working = $null; Confirm = $null; Notice = $null; Status = $null
        Log = (New-Object System.Collections.ArrayList); Progress = 0
        Queue = (New-Object System.Collections.ArrayList); Job = $null; Runspace = $null; ToastUntil = $null
    }
    $w = $script:CvWin

    # It must fit an old 1366x768 laptop as well as a big screen.
    $area = [Windows.SystemParameters]::WorkArea
    $window.Width = [Math]::Min(1000, $area.Width * 0.95)
    $window.Height = [Math]::Min(700, $area.Height * 0.92)
    try { $window.Icon = Get-CvLogoBitmap } catch { }
    $window.FindName('Logo').Content = New-CvLogo
    $window.FindName('ThemeBtn').Tag = @{ Do = 'theme' }
    $window.FindName('ThemeBtn').Add_Click({ Invoke-CvClick $this })

    Set-CvTheme (Get-CvDefaultTheme)

    if (-not $NoWorker) {
        $rs = [runspacefactory]::CreateRunspace()
        $rs.ApartmentState = 'STA'
        $rs.ThreadOptions = 'ReuseThread'
        $rs.Open()
        $w.Runspace = $rs
        $vars = @{ Repo = $Repo; Branch = $Branch; TaskName = $TaskName; InstallDir = $InstallDir; CommandFile = $CommandFile }
        Add-CvJob @{ Kind = 'load'; Source = (Get-CvWorkerSource); Vars = $vars; Done = 'Complete-CvLoad' }
        Request-CvStatus
    }

    Update-CvAll
    return $w
}

function Show-CvWindow {
    try {
        $w = New-CvWindow
    } catch {
        Write-Warn2 "The window could not open ($($_.Exception.Message)). Here is the text version instead."
        return 'failed'
    }
    $window = $w.Window

    $timer = New-Object Windows.Threading.DispatcherTimer
    $timer.Interval = [TimeSpan]::FromMilliseconds(120)
    $timer.Add_Tick({ Invoke-CvTick })

    $window.Add_SourceInitialized({
        $script:CvWin.Hwnd = (New-Object Windows.Interop.WindowInteropHelper($this)).Handle
        Set-CvTitleBar
    })
    # Something halfway through changing this PC has to finish first.
    $window.Add_Closing({
        try {
            if (Test-CvBusy) {
                $_.Cancel = $true
                $script:CvWin.Notice = @{ Kind = 'warn'; Text = 'Courier is being changed right now. The window closes once that is done.' }
                Update-CvContent
            }
        } catch { }
    })
    # Opened from a terminal, a window can land behind it. Bring it forward once.
    $window.Add_ContentRendered({ $this.Topmost = $true; $this.Activate(); $this.Topmost = $false })

    $timer.Start()
    try {
        [void]$window.ShowDialog()
    } finally {
        $timer.Stop()
        if ($w.Job) { try { [void]$w.Job.PS.BeginStop($null, $null) } catch { } }
        if ($w.Runspace) { try { $w.Runspace.CloseAsync() } catch { } }
    }
    return 'done'
}

# ---------------------------------------------------------------------- main --

if ($Uninstall) { Invoke-Uninstall; return }

# The desktop app, unless the window-less agent was asked for: on a desktop
# the setup window, else (or if it cannot open after all) the text version.
if (-not $Agent) {
    if (-not $Console -and (Test-CvWindowPossible)) {
        if ((Show-CvWindow) -ne 'failed') { return }
    }
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
