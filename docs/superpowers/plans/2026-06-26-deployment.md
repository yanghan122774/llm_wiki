# Deployment Solution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give non-developer users one-command install (Linux `curl | bash`, Windows `irm | iex`) plus a simple deployment guide, with pre-built packages from GitHub Releases.

**Architecture:** Two install scripts (shell + PowerShell) that auto-detect OS/arch, fetch the latest GitHub Release, download the correct installer, and install. Plus a rewritten `部署指南.md` focused on end-user installation (Option A from spec: app install only, not Claude Code integration).

**Tech Stack:** Bash (Linux), PowerShell 5.1+ (Windows), GitHub Releases API

**Spec:** [2026-06-26-deployment-design.md](../specs/2026-06-26-deployment-design.md)

## Global Constraints

- Install scripts must NOT hardcode a version number — always fetch latest release
- Install scripts must detect architecture (x86_64/amd64, aarch64/arm64) and pick the right package
- Linux script must work on both GUI (prefer AppImage) and headless (use deb)
- Windows script must use .msi (not .exe NSIS) for system-wide install
- `部署指南.md` covers app install ONLY; Claude Code integration stays in `agent-setup-guide.md`
- Release v0.5.0 must be tagged AFTER all other tasks, so the install scripts have a complete release to fetch
- Scripts placed in repo root, served via GitHub Raw

---

### Task 1: Create `install.sh` (Linux one-click installer)

**Files:**
- Create: `install.sh` (repo root)

**Interfaces:**
- Produces: `install.sh` — executable bash script, fetchable via `curl -fsSL https://raw.githubusercontent.com/yanghan122774/llm_wiki/main/install.sh | bash`

- [ ] **Step 1: Write the script**

Create `install.sh` in repo root:

```bash
#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

REPO="yanghan122774/llm_wiki"
API="https://api.github.com/repos/$REPO/releases/latest"

echo -e "${CYAN}══════════════════════════════════${NC}"
echo -e "${CYAN}  LLM Wiki — Linux 一键安装${NC}"
echo -e "${CYAN}══════════════════════════════════${NC}"
echo ""

# ── 1. Detect architecture ──
ARCH=$(uname -m)
case "$ARCH" in
  x86_64)  DEB_ARCH="amd64" ;;
  aarch64) DEB_ARCH="arm64" ;;
  armv7l)  DEB_ARCH="armhf" ;;
  *)
    echo -e "${RED}✗ 不支持的架构: $ARCH${NC}"
    echo "  支持的架构: x86_64, aarch64"
    exit 1
    ;;
esac
echo -e "  架构: ${GREEN}$ARCH${NC}"

# ── 2. Detect display server ──
HAS_GUI=0
if [ -n "${WAYLAND_DISPLAY:-}" ] || [ -n "${DISPLAY:-}" ]; then
  HAS_GUI=1
fi

if [ "$HAS_GUI" -eq 1 ]; then
  echo -e "  环境: ${GREEN}图形界面${NC}（优先 AppImage）"
else
  echo -e "  环境: ${YELLOW}终端${NC}（使用 deb 包）"
fi

# ── 3. Fetch latest release ──
echo ""
echo "  正在获取最新版本..."

RELEASE_JSON=$(curl -fsSL "$API" 2>/dev/null) || {
  echo -e "${RED}✗ 无法访问 GitHub Releases${NC}"
  echo "  请检查网络连接，或手动下载: https://github.com/$REPO/releases/latest"
  exit 1
}

VERSION=$(echo "$RELEASE_JSON" | grep -o '"tag_name": "[^"]*"' | cut -d'"' -f4)
echo -e "  最新版本: ${GREEN}$VERSION${NC}"

# ── 4. Find download URL ──
URL=""

if [ "$HAS_GUI" -eq 1 ]; then
  # Prefer AppImage for GUI systems
  URL=$(echo "$RELEASE_JSON" | grep -o '"browser_download_url": "[^"]*'"$DEB_ARCH"'[^"]*\.AppImage"' | head -1 | cut -d'"' -f4)
  PKG_TYPE="AppImage"
fi

if [ -z "$URL" ]; then
  # Fall back to .deb
  URL=$(echo "$RELEASE_JSON" | grep -o '"browser_download_url": "[^"]*'"$DEB_ARCH"'[^"]*\.deb"' | head -1 | cut -d'"' -f4)
  PKG_TYPE="deb"
fi

if [ -z "$URL" ]; then
  echo -e "${RED}✗ 未找到适用于 $ARCH 的安装包${NC}"
  echo "  请手动下载: https://github.com/$REPO/releases/latest"
  exit 1
fi

FILENAME=$(basename "$URL")
echo -e "  安装包: ${GREEN}$FILENAME${NC}"

# ── 5. Download ──
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

echo ""
echo "  正在下载..."
curl -fsSL -# -o "$TMPDIR/$FILENAME" "$URL" || {
  echo -e "${RED}✗ 下载失败${NC}"
  exit 1
}

SIZE=$(du -h "$TMPDIR/$FILENAME" | cut -f1)
echo -e "  下载完成 (${GREEN}$SIZE${NC})"

# ── 6. Install ──
echo ""
case "$FILENAME" in
  *.AppImage)
    echo "  安装到 ~/.local/bin/llm-wiki ..."
    mkdir -p "$HOME/.local/bin"
    cp "$TMPDIR/$FILENAME" "$HOME/.local/bin/llm-wiki"
    chmod +x "$HOME/.local/bin/llm-wiki"

    # Check if ~/.local/bin is in PATH
    if ! echo "$PATH" | tr ':' '\n' | grep -qxF "$HOME/.local/bin"; then
      echo -e "  ${YELLOW}⚠ ~/.local/bin 不在 PATH 中${NC}"
      echo "  请将以下行添加到 ~/.bashrc 或 ~/.profile:"
      echo -e "    ${CYAN}export PATH=\"\$HOME/.local/bin:\$PATH\"${NC}"
    fi

    echo ""
    echo -e "${GREEN}══════════════════════════════════${NC}"
    echo -e "${GREEN}  安装完成!${NC}"
    echo -e "${GREEN}══════════════════════════════════${NC}"
    echo ""
    echo "  启动: llm-wiki"
    ;;

  *.deb)
    echo "  安装 .deb 包（需要 sudo）..."
    sudo dpkg -i "$TMPDIR/$FILENAME" || {
      echo -e "${YELLOW}  正在修复依赖...${NC}"
      sudo apt-get install -f -y || {
        echo -e "${RED}✗ 安装失败${NC}"
        echo "  请尝试手动安装: sudo dpkg -i $TMPDIR/$FILENAME && sudo apt-get install -f -y"
        exit 1
      }
    }

    echo ""
    echo -e "${GREEN}══════════════════════════════════${NC}"
    echo -e "${GREEN}  安装完成!${NC}"
    echo -e "${GREEN}══════════════════════════════════${NC}"
    echo ""
    echo "  启动: 从应用菜单启动 LLM Wiki，或在终端输入 llm-wiki"
    ;;
esac

# ── 7. Check dependencies ──
echo ""
echo "  检查系统依赖..."

MISSING=""

# Check for libwebkit2gtk (Tauri WebView)
if ! ldconfig -p 2>/dev/null | grep -q "libwebkit2gtk-4.1" && \
   ! ldconfig -p 2>/dev/null | grep -q "libwebkit2gtk-4.0"; then
  MISSING="$MISSING libwebkit2gtk-4.1-0"
fi

# Check for libfuse2 (AppImage runtime)
if [ "$PKG_TYPE" = "AppImage" ] && ! ldconfig -p 2>/dev/null | grep -q "libfuse" && ! command -v fusermount &>/dev/null; then
  MISSING="$MISSING libfuse2"
fi

if [ -n "$MISSING" ]; then
  echo -e "  ${YELLOW}⚠ 可能缺少依赖:${MISSING}${NC}"
  echo "  安装命令: sudo apt-get install -y$MISSING"
else
  echo -e "  ${GREEN}✓ 系统依赖检查通过${NC}"
fi

echo ""
echo -e "下一步: 将 ${CYAN}agent-setup-guide.md${NC} 发给 Claude Code 完成知识库配置"
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x install.sh`
Verify: `bash -n install.sh` (syntax check, no output = OK)

- [ ] **Step 3: Dry-run test (skip download/install)**

Run: `head -30 install.sh && echo "--- syntax OK ---"`

- [ ] **Step 4: Commit**

```bash
git add install.sh
git commit -m "feat: add Linux one-click install script"
```

---

### Task 2: Create `install.ps1` (Windows one-click installer)

**Files:**
- Create: `install.ps1` (repo root)

**Interfaces:**
- Produces: `install.ps1` — PowerShell script, fetchable via `irm https://raw.githubusercontent.com/yanghan122774/llm_wiki/main/install.ps1 | iex`

- [ ] **Step 1: Write the script**

Create `install.ps1` in repo root:

```powershell
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

    # Re-launch as admin
    $ScriptPath = Join-Path $env:TEMP "llm-wiki-install.ps1"
    Copy-Item $PSCommandPath $ScriptPath -Force
    Start-Process PowerShell -Verb RunAs -ArgumentList "-ExecutionPolicy Bypass -File `"$ScriptPath`""
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
Write-Host "  下一步: 将 agent-setup-guide.md 发给 Claude Code 完成知识库配置" -ForegroundColor Gray
```

- [ ] **Step 2: Syntax validation**

Run PowerShell command to validate:
```powershell
powershell -Command "Get-Command -Syntax .\install.ps1" 2>&1 || echo "Syntax validation attempted"
```

- [ ] **Step 3: Commit**

```bash
git add install.ps1
git commit -m "feat: add Windows one-click install script"
```

---

### Task 3: Rewrite `部署指南.md`

**Files:**
- Modify: `部署指南.md` (repo root) — full rewrite

**Interfaces:**
- Consumes: `install.sh`, `install.ps1` from Tasks 1-2
- Produces: simplified deployment guide for end users

- [ ] **Step 1: Write the new `部署指南.md`**

Replace entire content of `部署指南.md`:

````markdown
# LLM Wiki 部署指南

**适用于:** 给团队成员 / 领导部署 llm_wiki 应用
**前提:** 无需编译，无需安装 Rust/Node.js

---

## 一、快速安装（推荐）

### Windows

**方法 1：一键安装（PowerShell）**

```powershell
irm https://raw.githubusercontent.com/yanghan122774/llm_wiki/main/install.ps1 | iex
```

**方法 2：手动下载**

1. 打开 [GitHub Releases](https://github.com/yanghan122774/llm_wiki/releases/latest)
2. 下载 `LLM_Wiki_x64.msi`
3. 双击安装，从开始菜单启动

### Linux

**方法 1：一键安装**

```bash
curl -fsSL https://raw.githubusercontent.com/yanghan122774/llm_wiki/main/install.sh | bash
```

**方法 2：手动下载**

1. 打开 [GitHub Releases](https://github.com/yanghan122774/llm_wiki/releases/latest)
2. Ubuntu/Debian → 下载 `.deb`，`sudo dpkg -i` 安装
3. 其他发行版 → 下载 `.AppImage`，`chmod +x` 后直接运行

### macOS

1. 打开 [GitHub Releases](https://github.com/yanghan122774/llm_wiki/releases/latest)
2. 下载 `.dmg`，拖入 Applications

### 验证安装

- Windows: 开始菜单启动 "LLM Wiki"，看到主窗口即成功
- Linux: 终端输入 `llm-wiki` 或从应用菜单启动
- macOS: 从 Applications 启动 "LLM Wiki"

---

## 二、安装后配置

应用安装完毕后，还需要两步才能使用经验积累系统：

| 步骤 | 说明 | 文档 |
|------|------|------|
| 1. 创建 wiki 项目 | 在应用中新建项目，选 **Experience (🧠)** 模板 | 应用内操作 |
| 2. 连接 Claude Code | 配置 Hook / MCP / CLAUDE.md | 把 [agent-setup-guide.md](agent-setup-guide.md) 发给 Claude Code，让它自动配置 |

---

## 三、从源码编译（开发者）

如果需要自己编译或修改代码：

### 前置依赖

| 组件 | Windows | Linux |
|------|---------|-------|
| Node.js ≥20 | [nodejs.org](https://nodejs.org/) | `nvm install 20` |
| Rust | `winget install Rustlang.Rustup` | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| Python ≥3.10 | [python.org](https://python.org/) | `sudo apt-get install python3` |
| 系统依赖 | VS Build Tools (C++ 桌面开发) | `sudo apt-get install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf protobuf-compiler xdg-utils` |

### 编译运行

```bash
git clone git@github.com:yanghan122774/llm_wiki.git
cd llm_wiki
npm install
cd mcp-server && npm install && npm run build && cd ..
npm run tauri dev
```

首次编译 Rust 需要 20-40 分钟，之后增量编译只需几秒。

---

## 四、常见问题

**Q: Linux 上运行 AppImage 提示 "fuse: failed to exec fusermount"？**
```bash
sudo apt-get install -y libfuse2
```

**Q: 应用启动后窗口空白？**
检查 `libwebkit2gtk-4.1` 是否安装：
```bash
dpkg -l | grep libwebkit2gtk
# 如缺失:
sudo apt-get install -y libwebkit2gtk-4.1-0
```

**Q: 中国大陆下载慢？**
- 挂 VPN
- 或用镜像站点下载 Release 文件

**Q: MCP 搜索无响应？**
确认 llm_wiki 应用正在运行，端口 19828 未被占用。检查 `curl http://127.0.0.1:19828/health`

**Q: 如何卸载？**
- Windows: 控制面板 → 程序和功能 → 卸载 LLM Wiki
- Linux (deb): `sudo dpkg -r llm-wiki`
- Linux (AppImage): 删除 `~/.local/bin/llm-wiki`
- macOS: 从 Applications 删除 LLM Wiki.app
````

- [ ] **Step 2: Verify markdown format**

Run: `wc -l 部署指南.md` (should be ~120 lines)

- [ ] **Step 3: Commit**

```bash
git add 部署指南.md
git commit -m "docs: rewrite 部署指南.md — end-user focused, install scripts + GitHub Releases"
```

---

### Task 4: Tag v0.5.0 release

**Files:**
- Modify: `package.json` (bump version)
- Modify: `src-tauri/tauri.conf.json` (bump version)

**Interfaces:**
- Produces: `v0.5.0` git tag → CI builds and publishes GitHub Release with MCP Server included

- [ ] **Step 1: Bump version numbers**

In `package.json`, change `"version": "0.4.24"` → `"version": "0.5.0"`

In `src-tauri/tauri.conf.json`, change `"version": "0.4.24"` → `"version": "0.5.0"`

- [ ] **Step 2: Commit the bump**

```bash
git add package.json src-tauri/tauri.conf.json
git commit -m "chore: bump version to 0.5.0"
```

- [ ] **Step 3: Tag and push**

```bash
git tag v0.5.0 -m "v0.5.0: MCP Server inclusion, schema-driven experience types, install scripts"
git push origin main
git push origin v0.5.0
```

- [ ] **Step 4: Monitor CI**

After pushing the tag, go to https://github.com/yanghan122774/llm_wiki/actions and wait for the `Build & Release` workflow to complete.

- [ ] **Step 5: Verify the release**

Check https://github.com/yanghan122774/llm_wiki/releases/tag/v0.5.0 — should have:
- `LLM_Wiki_x64.msi` (Windows)
- `LLM_Wiki_x64.exe` (Windows NSIS)
- `llm-wiki_0.5.0_amd64.deb` (Linux x86_64)
- `LLM_Wiki_x86_64.AppImage` (Linux x86_64)
- `llm-wiki_0.5.0_arm64.deb` (Linux ARM64)
- `LLM_Wiki_aarch64.AppImage` (Linux ARM64)
- macOS `.dmg`

- [ ] **Step 6: Quick smoke test of install scripts**

```bash
# Linux: check the script can parse the release (skip download)
curl -fsSL https://raw.githubusercontent.com/yanghan122774/llm_wiki/main/install.sh | head -30

# Windows: check the script exists and is valid
curl -fsSL -o /dev/null -w "%{http_code}" https://raw.githubusercontent.com/yanghan122774/llm_wiki/main/install.ps1
# Expected: 200
```

---

### Task 5: Final verification

- [ ] **Step 1: All files in place**

```bash
git log --oneline -8
# Should show: v0.5.0 tag, version bump, deploy guide, install.ps1, install.sh
```

- [ ] **Step 2: Verify install scripts are fetchable from raw**

```bash
curl -fsSL -o /dev/null -w "%{http_code}" https://raw.githubusercontent.com/yanghan122774/llm_wiki/main/install.sh
curl -fsSL -o /dev/null -w "%{http_code}" https://raw.githubusercontent.com/yanghan122774/llm_wiki/main/install.ps1
# Both should return: 200
```
