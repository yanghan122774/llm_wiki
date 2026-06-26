# LLM Wiki 部署方案 — 设计

**日期:** 2026-06-26
**状态:** 设计完成，待实现
**关联:** [schema-driven-experience-types](2026-06-26-schema-driven-experience-types-design.md)

---

## 一、目标

让非开发者（如领导、其他团队成员）能在自己的 Windows/Linux 电脑上安装并使用 llm_wiki，无需编译源码。

部署范围：**仅覆盖应用安装**。Wiki 项目创建和 Claude Code 集成配置由 `agent-setup-guide.md` 覆盖。

## 二、方案：GitHub Releases（主线）+ 一键安装脚本（便利层）

### 2.1 当前 CI 已产出

CI（`.github/workflows/build.yml`）在打 `v*` tag 时自动构建并发布到 GitHub Releases：

| 平台 | 格式 | 安装方式 |
|------|------|---------|
| Windows x64 | `.msi` | 双击安装，自动创建开始菜单快捷方式 |
| Windows x64 | `.exe` (NSIS) | 便携安装，无需管理员权限 |
| Linux x86_64 | `.deb` | `sudo dpkg -i` 或双击安装 |
| Linux x86_64 | `.AppImage` | 下载即运行，跨发行版通用 |
| Linux ARM64 | `.deb` | 树莓派 / ARM 服务器 |
| Linux ARM64 | `.AppImage` | ARM 设备通用 |
| macOS | `.dmg` | 拖入 Applications |

发布流程：打 tag → CI 构建 4 平台 → 自动发布到 GitHub Releases。无需改 CI。

### 2.2 一键安装脚本

两个脚本放在仓库根目录，通过 GitHub Raw URL 直接执行。无需先 clone 仓库。

#### `install.sh`（Linux）

```bash
curl -fsSL https://raw.githubusercontent.com/yanghan122774/llm_wiki/main/install.sh | bash
```

逻辑：
1. 检测系统架构（`uname -m` → x86_64 / aarch64）
2. 检测是否有图形环境 → Wayland/X11 用 AppImage，纯终端用 deb
3. 调用 GitHub API 获取最新 release 的下载 URL
4. 下载对应包
5. `.deb` → `sudo dpkg -i`，`apt-get install -f` 补依赖
6. `.AppImage` → `chmod +x`，放到 `~/.local/bin/`
7. 检查并提示缺失系统依赖（`libwebkit2gtk-4.1-dev` 等）

#### `install.ps1`（Windows PowerShell）

```powershell
irm https://raw.githubusercontent.com/yanghan122774/llm_wiki/main/install.ps1 | iex
```

逻辑：
1. 检测架构（x64 / arm64）
2. 调用 GitHub API 获取最新 `.msi` 下载链接
3. 下载到 `$env:TEMP`
4. 调用 `msiexec /i` 静默安装
5. 完成后提示在开始菜单启动

#### 共性
- 从 GitHub Releases API 拉取，不硬编码版本号
- 下载前显示文件大小
- 失败时给出明确错误提示

### 2.3 部署文档重构

把现有 `部署指南.md` 重构为两部分：

#### `部署指南.md`（精简版 — 给终端用户）

```
## 快速安装（推荐）

### Windows
1. 打开 https://github.com/yanghan122774/llm_wiki/releases/latest
2. 下载 LLM_Wiki_x64.msi，双击安装
3. 从开始菜单启动 LLM Wiki

### Linux
curl -fsSL https://raw.githubusercontent.com/yanghan122774/llm_wiki/main/install.sh | bash

或手动下载 .deb / .AppImage 安装。

## 从源码编译（开发者）

（保留现有编译步骤，精简）

## 下一步
- 创建 wiki 项目 → 发送 agent-setup-guide.md 给 Claude Code
```

#### `agent-setup-guide.md`（不改）

覆盖应用内创建 wiki + Claude Code 集成配置（Hook / MCP / CLAUDE.md）。

---

## 三、文件清单

| 文件 | 动作 | 说明 |
|------|------|------|
| `install.sh` | **新增** | Linux 一键安装脚本 |
| `install.ps1` | **新增** | Windows 一键安装脚本 |
| `部署指南.md` | **重写** | 精简为安装指南，源码编译为次要内容 |
| `.github/workflows/build.yml` | **不改** | 已满足需求 |
| `agent-setup-guide.md` | **不改** | 集成配置走这个 |

## 四、风险

1. **GitHub API 限流** — 未认证的 API 请求每小时 60 次。缓解：脚本里提示用户设置 `GITHUB_TOKEN` 环境变量。
2. **中国大陆访问 GitHub** — 下载可能慢或失败。缓解：文档里注明可挂 VPN 或使用镜像。
3. **系统依赖缺失** — Linux 上 `.AppImage` 可能因缺少 `libfuse2` 或 `libwebkit2gtk` 无法运行。缓解：`install.sh` 检测并提示安装命令。

## 五、验证

1. Linux 虚拟机测试 `curl install.sh | bash`，确认应用启动正常
2. Windows 虚拟机测试 `irm install.ps1 | iex`，确认安装成功
3. 发布 `v0.5.0` tag，验证 GitHub Release 产物齐全
4. 给未装过任何依赖的干净系统测试，确认错误提示完整
