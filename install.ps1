<#
.SYNOPSIS
  LLM Wiki — Windows 一键安装
.DESCRIPTION
  从 GitHub Releases 下载最新 .msi 安装包并静默安装。
  运行方式: irm https://raw.githubusercontent.com/yanghan122774/llm_wiki/main/install.ps1 | iex
#>

$ErrorActionPreference = "Stop"

Write-Host "╔══════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  LLM Wiki — Windows 一键安装      ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

$Repo = "yanghan122774/llm_wiki"
$ApiUrl = "https://api.github.com/repos/$Repo/releases/latest"

# ── 1. Detect architecture ──
$Arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
Write-Host "  架构: $Arch" -ForegroundColor Green

# ── 2. Check admin (msiexec needs it) ──
$IsAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")
if (-not $IsAdmin) {
    Write-Host "  ⚠ 需要管理员权限才能安装 .msi" -ForegroundColor Yellow
    Write-Host "  正在请求管理员权限..." -ForegroundColor Yellow

    # Save this script to a temp file so we can re-launch as admin.
    # $PSCommandPath is empty when piped via irm | iex, so we write
    # the script source from $MyInvocation — for piped execution we
    # fall back to re-downloading from GitHub raw.
    $ElevatedScript = Join-Path $env:TEMP "llm-wiki-install.ps1"

    if ($PSCommandPath) {
        Copy-Item $PSCommandPath $ElevatedScript -Force
    } else {
        # Piped execution (irm | iex): re-download the script to a temp file
        Invoke-WebRequest -Uri "https://raw.githubusercontent.com/yanghan122774/llm_wiki/main/install.ps1" -OutFile $ElevatedScript
    }

    Start-Process PowerShell -Verb RunAs -ArgumentList "-ExecutionPolicy Bypass -File `"$ElevatedScript`""
    exit 0
}

# ── 3. Fetch latest release ──
Write-Host ""
Write-Host "  正在获取最新版本..." -ForegroundColor Gray

try {
    $Release = Invoke-RestMethod -Uri $ApiUrl -TimeoutSec 15
} catch {
    Write-Host "✗ 无法访问 GitHub Releases" -ForegroundColor Red
    Write-Host "  请检查网络连接，或手动下载: https://github.com/$Repo/releases/latest" -ForegroundColor Red
    exit 1
}

$Version = $Release.tag_name
Write-Host "  最新版本: $Version" -ForegroundColor Green

# ── 4. Find .msi download URL ──
$MsiAsset = $Release.assets | Where-Object {
    $_.name -match "\.msi$" -and $_.name -match $Arch
} | Select-Object -First 1

if (-not $MsiAsset) {
    Write-Host "✗ 未找到适用于 $Arch 的 .msi 安装包" -ForegroundColor Red
    Write-Host "  请手动下载: https://github.com/$Repo/releases/latest" -ForegroundColor Red
    exit 1
}

$SizeMB = [math]::Round($MsiAsset.size / 1MB, 1)
Write-Host "  安装包: $($MsiAsset.name) ($SizeMB MB)" -ForegroundColor Green

# ── 5. Download ──
$TempDir = $env:TEMP
$Installer = Join-Path $TempDir $MsiAsset.name
Write-Host ""
Write-Host "  正在下载..." -ForegroundColor Gray

try {
    Invoke-WebRequest -Uri $MsiAsset.browser_download_url -OutFile $Installer
} catch {
    Write-Host "✗ 下载失败: $_" -ForegroundColor Red
    exit 1
}

Write-Host "  下载完成" -ForegroundColor Green

# ── 6. Install ──
Write-Host ""
Write-Host "  正在安装（静默模式）..." -ForegroundColor Gray

$ExitCode = (Start-Process msiexec.exe -ArgumentList "/i `"$Installer`" /quiet /norestart" -Wait -PassThru).ExitCode

if ($ExitCode -eq 0 -or $ExitCode -eq 3010) {
    Write-Host ""
    Write-Host "╔══════════════════════════════════╗" -ForegroundColor Green
    Write-Host "║  安装完成!                       ║" -ForegroundColor Green
    Write-Host "╚══════════════════════════════════╝" -ForegroundColor Green
    Write-Host ""
    Write-Host "  从开始菜单启动 LLM Wiki" -ForegroundColor Cyan

    if ($ExitCode -eq 3010) {
        Write-Host "  ⚠ 需要重启电脑以完成安装" -ForegroundColor Yellow
    }
} else {
    Write-Host "✗ 安装失败 (退出码: $ExitCode)" -ForegroundColor Red
    Write-Host "  请尝试手动安装: msiexec /i `"$Installer`"" -ForegroundColor Yellow
    exit 1
}

# ── 7. Cleanup ──
Remove-Item $Installer -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "  下一步: 将 agent-deploy-guide.md 发给 Claude Code 完成知识库配置" -ForegroundColor Gray

