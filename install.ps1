<#
.SYNOPSIS
    secops-squad installer for Windows
.DESCRIPTION
    Installs secops-squad -- AI SecOps team for Microsoft Security stack.
    Checks prerequisites, clones the repository, installs dependencies.

    To override the install directory, set $env:SECOPS_INSTALL_DIR before piping:
        $env:SECOPS_INSTALL_DIR = "C:\tools\secops-squad"
        irm https://raw.githubusercontent.com/x3nc0n/secops-squad-starter-kit/main/install.ps1 | iex
.EXAMPLE
    irm https://raw.githubusercontent.com/x3nc0n/secops-squad-starter-kit/main/install.ps1 | iex
.EXAMPLE
    $env:SECOPS_INSTALL_DIR = "C:\tools\secops-squad"
    irm https://raw.githubusercontent.com/x3nc0n/secops-squad-starter-kit/main/install.ps1 | iex
.EXAMPLE
    .\install.ps1
#>

if ($PSVersionTable.PSVersion.Major -lt 5) {
    Write-Error "secops-squad requires PowerShell 5.1 or later."; return
}

$InstallDir = if ($env:SECOPS_INSTALL_DIR) { $env:SECOPS_INSTALL_DIR } else { "$env:USERPROFILE\secops-squad" }

$ErrorActionPreference = "Stop"

$RepoUrl = "https://github.com/x3nc0n/secops-squad-starter-kit.git"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Write-Banner {
    Write-Host ""
    Write-Host "  +-------------------------------------+" -ForegroundColor Cyan
    Write-Host "  |  secops-squad installer              |" -ForegroundColor Cyan
    Write-Host "  |  AI SecOps team for Microsoft        |" -ForegroundColor Cyan
    Write-Host "  |  Security stack                      |" -ForegroundColor Cyan
    Write-Host "  +-------------------------------------+" -ForegroundColor Cyan
    Write-Host ""
}

function Refresh-Path {
    # Re-read PATH from the registry so tools installed by winget are visible
    # in the current session without restarting the terminal.
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath    = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path    = "$machinePath;$userPath"
}

function Test-WingetAvailable {
    $cmd = Get-Command "winget" -ErrorAction SilentlyContinue
    return [bool]$cmd
}

function Install-WithWinget {
    param(
        [string]$PackageId,
        [string]$DisplayName
    )
    Write-Host "  [....] Installing ${DisplayName} via winget..." -ForegroundColor Cyan
    & winget install $PackageId --accept-source-agreements --accept-package-agreements --silent 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [FAIL] winget install failed for ${DisplayName}" -ForegroundColor Red
        return $false
    }
    Refresh-Path
    Write-Host "  [OK] ${DisplayName} installed" -ForegroundColor Green
    return $true
}

function Ensure-Command {
    <#
    .SYNOPSIS
        Check for a command. If missing and winget is available, install it.
        Returns $true if the command is available after the check.
    #>
    param(
        [string]$Command,
        [string]$DisplayName,
        [string]$WingetPackage,
        [string]$ManualUrl,
        [bool]$Required = $true
    )

    $cmd = Get-Command $Command -ErrorAction SilentlyContinue
    if ($cmd) {
        try {
            $version = & $Command --version 2>&1 | Select-Object -First 1
        } catch {
            $version = "installed"
        }
        Write-Host "  [OK] ${DisplayName}: $version" -ForegroundColor Green
        return $true
    }

    # Command not found
    Write-Host "  [MISS] ${DisplayName} not found" -ForegroundColor Yellow

    if ($script:HasWinget -and $WingetPackage) {
        $installed = Install-WithWinget $WingetPackage $DisplayName
        if ($installed) {
            # Verify the command is now on PATH
            $cmd = Get-Command $Command -ErrorAction SilentlyContinue
            if ($cmd) { return $true }
        }
        Write-Host "  [FAIL] ${DisplayName} still not found after install" -ForegroundColor Red
        Write-Host "     Install manually: $ManualUrl" -ForegroundColor DarkGray
        if ($Required) { return $false } else { return $true }
    }

    # No winget -- fall back to manual instructions
    if ($Required) {
        Write-Host "  [FAIL] ${DisplayName} is required" -ForegroundColor Red
    } else {
        Write-Host "  [WARN] ${DisplayName} is optional" -ForegroundColor Yellow
    }
    Write-Host "     Install: $ManualUrl" -ForegroundColor DarkGray
    if ($Required) { return $false } else { return $true }
}

function Ensure-NodeVersion {
    <#
    .SYNOPSIS
        Node.js requires extra version validation (>= 18).
    #>
    $nodeCmd = Get-Command "node" -ErrorAction SilentlyContinue

    if (-not $nodeCmd) {
        Write-Host "  [MISS] Node.js not found" -ForegroundColor Yellow

        if ($script:HasWinget) {
            $installed = Install-WithWinget "OpenJS.NodeJS.LTS" "Node.js LTS"
            if (-not $installed) {
                Write-Host "  [FAIL] Node.js is required" -ForegroundColor Red
                Write-Host "     Install manually: https://nodejs.org" -ForegroundColor DarkGray
                return $false
            }
            $nodeCmd = Get-Command "node" -ErrorAction SilentlyContinue
            if (-not $nodeCmd) {
                Write-Host "  [FAIL] Node.js still not found after install" -ForegroundColor Red
                Write-Host "     Install manually: https://nodejs.org" -ForegroundColor DarkGray
                return $false
            }
        } else {
            Write-Host "  [FAIL] Node.js 18+ is required" -ForegroundColor Red
            Write-Host "     Install: https://nodejs.org" -ForegroundColor DarkGray
            return $false
        }
    }

    $version = & node -v 2>&1
    $major = [int]($version -replace "^v" -split "\." | Select-Object -First 1)

    if ($major -ge 18) {
        Write-Host "  [OK] Node.js $version (>= 18 required)" -ForegroundColor Green
        return $true
    } else {
        Write-Host "  [FAIL] Node.js $version -- version 18+ required" -ForegroundColor Red
        Write-Host "     Upgrade: https://nodejs.org" -ForegroundColor DarkGray
        return $false
    }
}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

function Install-SecOpsSquad {
    Write-Banner

    # --- winget availability ---
    Write-Host "Checking package manager..." -ForegroundColor White
    $script:HasWinget = Test-WingetAvailable
    if ($script:HasWinget) {
        Write-Host "  [OK] winget available -- missing tools will be installed automatically" -ForegroundColor Green
    } else {
        Write-Host "  [WARN] winget not found -- you may need to install tools manually" -ForegroundColor Yellow
        Write-Host "     winget ships with Windows 10 (1709+) and Windows 11." -ForegroundColor DarkGray
        Write-Host "     Get it: https://aka.ms/getwinget" -ForegroundColor DarkGray
    }
    Write-Host ""

    # --- Required dependencies (order matters) ---
    Write-Host "Checking dependencies..." -ForegroundColor White
    Write-Host ""

    $failed = $false

    # 1. Git
    if (-not (Ensure-Command "git" "Git" "Git.Git" "https://git-scm.com" $true)) {
        $failed = $true
    }

    # 2. Node.js 18+
    if (-not (Ensure-NodeVersion)) {
        $failed = $true
    }

    # 3. GitHub CLI (optional -- connect later during copilot session)
    $ghAvailable = Ensure-Command "gh" "GitHub CLI" "GitHub.cli" "https://cli.github.com" $false

    # 4. GitHub Copilot CLI (standalone -- ships with GitHub Copilot, not a gh extension)
    $copilotCmd = Get-Command copilot -ErrorAction SilentlyContinue
    if ($copilotCmd) {
        Write-Host "  [OK] GitHub Copilot CLI (copilot)" -ForegroundColor Green
    } else {
        Write-Host "  [INFO] GitHub Copilot CLI not found (optional)" -ForegroundColor Cyan
        Write-Host "     The standalone copilot CLI ships with GitHub Copilot." -ForegroundColor DarkGray
        Write-Host "     Install:  npm install -g @github/copilot" -ForegroundColor DarkGray
        Write-Host "     Or:       winget install GitHub.Copilot" -ForegroundColor DarkGray
        Write-Host "     Docs:     https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli" -ForegroundColor DarkGray
    }

    # 5. Azure CLI (optional)
    Ensure-Command "az" "Azure CLI" "Microsoft.AzureCLI" "https://aka.ms/installazurecliwindows" $false | Out-Null

    Write-Host ""

    if ($failed) {
        Write-Host "Prerequisites check failed." -ForegroundColor Red
        Write-Host "Install the missing tools above and re-run this script." -ForegroundColor DarkGray
        Write-Host ""
        exit 1
    }

    Write-Host "[OK] All required dependencies met." -ForegroundColor Green
    Write-Host ""

    if (Test-Path $InstallDir) {
        Write-Host "Directory $InstallDir already exists." -ForegroundColor Yellow
        Write-Host "Remove it first or set `$env:SECOPS_INSTALL_DIR to a different location." -ForegroundColor DarkGray
        Write-Host ""
        exit 1
    }

    # Download the repo content (shallow clone), then create a standalone repo
    Write-Host "Downloading secops-squad..." -ForegroundColor Cyan
    $TempDir = Join-Path $env:TEMP "secops-squad-download-$(Get-Random)"
    # Temporarily allow stderr output from git without triggering a terminating
    # error in PS5.1 (git writes progress info to stderr even on success).
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $gitOutput = & git clone --depth 1 $RepoUrl $TempDir 2>&1
    $gitExit = $LASTEXITCODE
    $ErrorActionPreference = $prevEAP
    if ($gitExit -ne 0) {
        Write-Host "  Failed to download secops-squad (git clone exit code $gitExit):" -ForegroundColor Red
        Write-Host ($gitOutput -join "`n") -ForegroundColor DarkGray
        exit 1
    }

    # Copy content (without .git) to create a standalone project
    Write-Host "Creating your secops-squad project..." -ForegroundColor Cyan
    Copy-Item -Path $TempDir -Destination $InstallDir -Recurse -Force
    Remove-Item -Path (Join-Path $InstallDir ".git") -Recurse -Force

    Write-Host "Resetting squad cast for fresh consumer install..." -ForegroundColor Cyan
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & node (Join-Path $InstallDir "scripts\reset-squad.js") $InstallDir
    $resetExit = $LASTEXITCODE
    $ErrorActionPreference = $prevEAP
    if ($resetExit -ne 0) {
        Write-Host "Squad reset failed. Aborting." -ForegroundColor Red
        Remove-Item -Path $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
        exit 1
    }

    # Initialize a fresh git repo
    Push-Location $InstallDir
    & git init --quiet
    & git add .
    & git commit --quiet -m "Initialize secops-squad project"
    Pop-Location

    # Clean up temp download
    Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue

    # Install dependencies
    Write-Host "Installing dependencies..." -ForegroundColor Cyan
    Push-Location $InstallDir
    try {
        & npm install --production --quiet 2>$null
    } catch {
        Write-Host "  npm install had warnings (non-blocking)" -ForegroundColor Yellow
    }
    Pop-Location

    # Add install directory to PATH (for the secops-squad.cmd shim)
    # Session PATH - immediate effect in this terminal
    if ($env:Path -notlike "*$InstallDir*") {
        $env:Path = "$InstallDir;$env:Path"
    }

    # Persistent user-level PATH - survives terminal restarts
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if (-not $userPath) { $userPath = "" }
    if ($userPath -notlike "*$InstallDir*") {
        if ($userPath -and -not $userPath.EndsWith(";")) {
            $userPath = "$userPath;"
        }
        $userPath = "$userPath$InstallDir"
        [Environment]::SetEnvironmentVariable("Path", $userPath, "User")
        Write-Host "  [OK] Added $InstallDir to user PATH" -ForegroundColor Green
    } else {
        Write-Host "  [OK] $InstallDir already in user PATH" -ForegroundColor Green
    }

    Write-Host ""
    Write-Host "[OK] secops-squad installed!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor White
    Write-Host "  1. cd $InstallDir" -ForegroundColor Cyan
    Write-Host "  2. copilot --agent secops-squad --yolo" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "That's it! The agent will help you connect GitHub CLI" -ForegroundColor DarkGray
    Write-Host "and Azure when you need them." -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "Note: Other open terminals may need to be restarted" -ForegroundColor DarkGray
    Write-Host "for the PATH change to take effect." -ForegroundColor DarkGray
    Write-Host "  First run tip:" -ForegroundColor Cyan
    Write-Host "  Your first 'copilot --agent secops-squad' session will cast your AI team." -ForegroundColor DarkGray
    Write-Host "  The Squad Coordinator will propose a team roster -- just confirm to proceed." -ForegroundColor DarkGray
    Write-Host ""
}

Install-SecOpsSquad