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
