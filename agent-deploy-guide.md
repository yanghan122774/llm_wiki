# Agent Deploy Guide — 经验系统自动部署

<!--
  目标读者: Claude Code (Agent)
  触发: 用户说 "配置经验系统" / "部署知识库" / "接入 wiki" / "setup experience system"
  平台: Windows / Linux / macOS 通用
-->

## 角色

你是 llm_wiki 经验系统的部署助手。你的任务是将经验积累系统接入用户的开发项目，使 Claude Code 会话结束时自动提取经验到 wiki 知识库。

**关键原则:**
- 每一步都验证，不假设默认值
- 路径始终使用正斜杠 `/`（所有平台通用）
- 遇到错误停下来诊断，不要静默跳过

---

## Phase 0 — 定位 llm_wiki

按顺序搜索:

```
1. 当前 Claude Code 工作目录: 检查是否同时存在 package.json + src-tauri/ + experience-system/
   → 源码/开发模式
2. ~/work/llm_wiki/
3. ~/llm_wiki/
4. /opt/llm_wiki/
5. 已安装应用模式 — 按平台搜索稳定提取路径 (app_data_dir):
   - Linux:   ~/.local/share/com.llmwiki.app/
   - macOS:   ~/Library/Application Support/com.llmwiki.app/
   - Windows: ~/AppData/Roaming/com.llmwiki.app/
6. 已安装应用模式 — 按平台搜索安装目录 (resource_dir):
   - Linux deb:       /usr/lib/llm-wiki/
   - macOS:           /Applications/LLM Wiki.app/Contents/Resources/
   - Windows MSI/NSIS: C:/Program Files/LLM Wiki/
7. 问用户: "llm_wiki 安装在哪个目录？"
```

找到后记 `$WIKI_APP`。

**源码模式验证清单:** (步骤 1-4 命中时)
- `$WIKI_APP/package.json` 存在
- `$WIKI_APP/src-tauri/` 存在
- `$WIKI_APP/experience-system/config/settings.json` 存在
- `$WIKI_APP/experience-system/tools/capture_session.py` 存在

如果 `$WIKI_APP/mcp-server/dist/src/index.js` 不存在:
```bash
cd $WIKI_APP/mcp-server && npm install && npm run build
```

**已安装应用模式验证清单:** (步骤 5-6 命中时)

记 `$EXPERIENCE_DIR` = `$WIKI_APP/experience-system`
记 `$MCP_SERVER` = `$WIKI_APP/mcp-server/dist/src/index.js`

验证:
- `$EXPERIENCE_DIR/tools/capture_session.py` 存在
- `$MCP_SERVER` 存在 (如果不存在，检查 app_data_dir 提取目录)

**平台快速参考:**

| 平台 | `$EXPERIENCE_DIR` | `$MCP_SERVER` |
|------|-------------------|---------------|
| Linux (deb) | `/usr/lib/llm-wiki/experience-system` | `/usr/lib/llm-wiki/mcp-server/dist/src/index.js` |
| Linux (AppImage)* | `~/.local/share/com.llmwiki.app/experience-system` | `~/.local/share/com.llmwiki.app/mcp-server/dist/src/index.js` |
| macOS | `/Applications/LLM Wiki.app/Contents/Resources/experience-system` | 同上 `.../mcp-server/dist/src/index.js` |
| Windows | `C:/Program Files/LLM Wiki/experience-system` | `C:/Program Files/LLM Wiki/mcp-server/dist/src/index.js` |

> *AppImage: 资源在挂载点内(随机路径)，应用首次启动时自动提取到 `app_data_dir`。使用提取后的路径。

---

## Phase 1 — 收集信息

按顺序询问，一次一个问题。

### 1.1 开发项目名

```
问: "你的开发项目叫什么名字？（用于经验标记来源，如 smart-lock-firmware）"
```

记 `$PROJECT_NAME`。必须非空。

### 1.2 技术领域

```
问: "这个项目的技术领域是什么？（如 embedded-arm, web-frontend, rust-backend）"
```

记 `$DOMAIN`。如果用户不知道，从项目文件推断（`package.json` → `web-frontend`，`Cargo.toml` → `rust-backend`），推断不出用 `general`。

### 1.3 开发项目根目录

```
当前 Claude Code 工作目录 = $DEV_PROJECT
问: "你的开发项目在哪个目录？（回车确认当前: $DEV_PROJECT）"
```

### 1.4 Wiki 项目位置

```
问: "经验存储到哪个 wiki？"
  A) 创建新 wiki 项目（需先启动 llm_wiki 应用）
  B) 已有 wiki 项目 — 告诉我完整路径
```

- 选 A: 跳到 Phase 2
- 选 B: 记 `$WIKI_PROJECT`，验证路径存在且有 `wiki/` 子目录

---

## Phase 2 — 创建 Wiki 项目（仅 Phase 1.4 选 A）

### 2.1 检测平台

```bash
# 判断操作系统
case "$(uname -s)" in
  Linux*)  OS=linux;;
  Darwin*) OS=macos;;
  CYGWIN*|MINGW*|MSYS*) OS=windows;;
esac
```

### 2.2 启动 llm_wiki 应用

如果应用已在运行（`curl -s http://127.0.0.1:19828/health` 返回 ok），跳到 2.3。

```bash
cd $WIKI_APP && npm run tauri dev
```

等待应用窗口弹出。如果首次编译，Rust 编译可能需要 20-40 分钟。

**Linux 注意:** 如果遇到 `cargo fetch` 超时，需要先配置镜像:
```bash
mkdir -p ~/.cargo
cat > ~/.cargo/config.toml << 'EOF'
[source.crates-io]
replace-with = 'tuna'

[source.tuna]
registry = "https://mirrors.tuna.tsinghua.edu.cn/git/crates.io-index.git"

[net]
git-fetch-with-cli = true
EOF
```

### 2.3 引导用户创建项目

告诉用户:
```
请在 llm_wiki 窗口中:
1. 点击 "New Project" 或 "新建项目"
2. 项目名 → $PROJECT_NAME-experiences
3. 模板 → 选 "Experience (🧠)"
4. 父目录 → 选择一个合适的目录
5. 点击 Create
6. 把项目完整路径告诉我
```

用户回复后记 `$WIKI_PROJECT`。

---

## Phase 3 — 检测平台并确定命令

### 3.1 确定 Python 命令

不同平台 Python 命令不同:

```bash
# 检测哪个 Python 命令可用
if command -v python3 &>/dev/null; then
  PYTHON_CMD="python3"
elif command -v python &>/dev/null; then
  PYTHON_CMD="python"
else
  echo "ERROR: Python 3 未安装"
fi
```

**关键:** Linux (Ubuntu) 没有 `python` 命令，只有 `python3`。Windows 上两者通常都有。

### 3.2 验证 Python 版本

```bash
$PYTHON_CMD --version
```

必须 ≥ 3.10。如果 < 3.10，告知用户升级 Python。

---

## Phase 4 — 配置开发项目

### 4.1 创建目录

```bash
mkdir -p $DEV_PROJECT/.claude/skills
```

### 4.2 写入 settings.json（关键！）

**直接写入，不要复制模板再替换。** 使用标准的 `matcher` + `hooks` 嵌套格式（`/doctor` 要求的格式）。

如果 Phase 0 检测到**源码模式**（有 package.json），用 `$WIKI_APP` 路径。
如果 Phase 0 检测到**已安装应用模式**，用 `$EXPERIENCE_DIR` 路径（`$WIKI_APP/experience-system`）。

写入 `$DEV_PROJECT/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "$PYTHON_CMD $EXPERIENCE_DIR/tools/capture_session.py --stdin"
          }
        ]
      }
    ]
  },
  "env": {
    "LLM_WIKI_PROJECT": "$PROJECT_NAME",
    "LLM_WIKI_DOMAIN": "$DOMAIN",
    "LLM_WIKI_ROOT": "$WIKI_APP",
    "LLM_WIKI_OUTPUT_DIR": "$WIKI_PROJECT/raw/sources/experiences"
  }
}
```

> `$EXPERIENCE_DIR` 在源码模式 = `$WIKI_APP/experience-system`
> 在安装模式 = 上表 Phase 0 的对应路径。

**格式要点:**
- ✅ 使用 `matcher` + `hooks` 嵌套结构（`matcher: ""` 匹配所有操作）
- ✅ 所有路径用正斜杠 `/`，包括 Windows 路径
- ✅ 用 `$PYTHON_CMD` 的值（`python3` 或 `python`），不要硬编码

### 4.3 创建输出目录

```bash
mkdir -p $WIKI_PROJECT/raw/sources/experiences
```

### 4.4 复制 Skill

```bash
cp $WIKI_APP/experience-system/skills/xp.md $DEV_PROJECT/.claude/skills/xp.md
```

### 4.5 验证 settings.json

```bash
# 确认没有残留的 <...> 占位符
grep -E '<[^>]+>' $DEV_PROJECT/.claude/settings.json && echo "FAIL: 有未替换的占位符" || echo "OK"

# 确认是嵌套结构（matcher + hooks 包装，/doctor 要求）
$PYTHON_CMD -c "
import json
with open('$DEV_PROJECT/.claude/settings.json') as f:
    cfg = json.load(f)
hooks = cfg['hooks']['SessionEnd']
for h in hooks:
    assert 'matcher' in h, 'Hook 缺少 matcher 字段'
    assert 'hooks' in h and isinstance(h['hooks'], list), 'Hook 缺少嵌套的 hooks 数组'
    for inner in h['hooks']:
        assert 'type' in inner, '内层 Hook 缺少 type 字段'
        assert 'command' in inner, '内层 Hook 缺少 command 字段'
print('Hook 格式验证通过（嵌套结构）')
"
```

---

## Phase 5 — 配置 CLAUDE.md

### 5.1 检查是否已有 CLAUDE.md

```
如果 $DEV_PROJECT/CLAUDE.md 已存在 → 追加经验系统段落（5.3）
如果不存在 → 写入完整模板（5.2）
```

### 5.2 完整模板（新建 CLAUDE.md）

写入 `$DEV_PROJECT/CLAUDE.md`:

```markdown
# KB-Loader: skip

本项目使用外部经验系统，经验通过 SessionEnd Hook 自动汇入。

## 经验系统

### 知识库位置
- Wiki 项目: $WIKI_PROJECT
- 通过 MCP `llm_wiki_search` 搜索经验

### 会话启动: 项目情境加载

启动时按顺序执行:

**Step 1** — 用 `llm_wiki_read_file` 读取 `wiki/purpose.md`，获取项目名、技术栈、当前关注点。

**Step 2** — 用 `llm_wiki_read_file` 读取 `wiki/log.md` 最近 5 条，了解上次会话。

**Step 3** — 用 `llm_wiki_files` 列出 `wiki/bugs/`，逐个读取 frontmatter，筛选 status=unresolved。

**Step 4** — 用 `llm_wiki_files` 列出 `wiki/decisions/`，逐个读取 frontmatter，筛选 status=proposed。

**Step 5** (可选) — `git branch` + `git status` 交叉比对上下文。

**Step 6** — 按以下格式输出情境摘要:

📋 **项目情境加载完成**

**项目:** <项目名> (<技术栈>)
**阶段:** <当前关注点>
**上次会话:** YYYY-MM-DD — <最近 log>

⚠️ **待解决:** N bugs / M decisions 待定
- [[bug-slug]] — 描述 (日期)
- [[decision-slug]] — 描述 (日期)

📌 **相关经验:** (基于 git 上下文自动搜索)

### 自动搜索

遇到以下情况主动通过 MCP `llm_wiki_search` 搜索:
- 编译/运行时错误（含 error、failed、panic、cannot、undefined is not 等）
- 配置文件不生效、格式错误
- 环境依赖问题（找不到工具、版本不兼容）
- 重复性工作（"上次怎么做的"、"又遇到这个"）

命中时: ⚠️ 知识库有相关经验: [[PageName]] — 摘要

### 手动标记

- `xp` — 由 Skill 拦截，只输出轻量标记，不写文件
- "提炼经验" / "记录这个坑" — 同样只做标记
```

### 5.3 追加模板（已有 CLAUDE.md）

读取 `$DEV_PROJECT/CLAUDE.md`，追加:

```markdown

## 经验系统

本项目使用外部经验系统。

### 知识库位置
- Wiki 项目: $WIKI_PROJECT
- 通过 MCP `llm_wiki_search` 搜索经验

### 会话启动: 项目情境加载

启动时按顺序执行:

**Step 1** — 用 `llm_wiki_read_file` 读取 `wiki/purpose.md`，获取项目名、技术栈、当前关注点。

**Step 2** — 用 `llm_wiki_read_file` 读取 `wiki/log.md` 最近 5 条，了解上次会话。

**Step 3** — 用 `llm_wiki_files` 列出 `wiki/bugs/`，逐个读取 frontmatter，筛选 status=unresolved。

**Step 4** — 用 `llm_wiki_files` 列出 `wiki/decisions/`，逐个读取 frontmatter，筛选 status=proposed。

**Step 5** (可选) — `git branch` + `git status` 交叉比对上下文。

**Step 6** — 按格式输出情境摘要。

### 自动搜索

遇到以下情况主动通过 MCP `llm_wiki_search` 搜索:
- 编译/运行时错误（含 error、failed、panic、cannot 等）
- 配置文件不生效
- 环境依赖问题
- 重复性工作

命中时: ⚠️ 知识库有相关经验: [[PageName]] — 摘要

### 手动标记

- `xp` — Skill 拦截，轻量标记
- "提炼经验" / "记录这个坑" — 同样只做标记
```

---

## Phase 6 — 配置 MCP

### 6.1 检查全局 MCP 配置

Claude Code 的全局 MCP 配置位置因平台而异:

| 平台 | 路径 |
|------|------|
| Windows | `$HOME/.claude/.mcp.json` |
| Linux | `$HOME/.claude/.mcp.json` |
| macOS | `$HOME/.claude/.mcp.json` |

### 6.2 检测 node 绝对路径

Claude Code 启动 MCP 子进程时**不继承终端 PATH**，`"command": "node"` 可能解析失败（尤其在 Windows 上）。必须用绝对路径:

```bash
# Windows — 先试 cmd，失败则试 PowerShell
NODE_PATH=$(cmd.exe /c "where node" 2>/dev/null | head -1)
if [ -z "$NODE_PATH" ]; then
  NODE_PATH=$(powershell.exe -Command "Get-Command node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source" 2>/dev/null)
fi

# Linux / macOS
if [ -z "$NODE_PATH" ]; then
  NODE_PATH=$(which node 2>/dev/null || echo "")
fi

echo "Node 绝对路径: $NODE_PATH"
```

找不到则问用户。

### 6.3 写入/合并 MCP 配置

```
如果 $HOME/.claude/.mcp.json 不存在:
  写入:
  {
    "mcpServers": {
      "llm-wiki": {
        "command": "$NODE_PATH",
        "args": ["$MCP_SERVER"]
      }
    }
  }

如果已存在:
  读取 → 检查 mcpServers 下是否已有 "llm-wiki" 条目
  如果没有 → 合并进去，保持 JSON 完整
```

> `$MCP_SERVER` = `$WIKI_APP/mcp-server/dist/src/index.js` (源码模式)
> 或 = Phase 0 表格中对应平台路径 (安装模式)

---

## Phase 7 — 验证

### 7.1 文件存在性

```
✅ $DEV_PROJECT/.claude/settings.json
✅ $DEV_PROJECT/.claude/skills/xp.md
✅ $DEV_PROJECT/CLAUDE.md (含经验系统段落)
✅ $WIKI_PROJECT/raw/sources/experiences/ (输出目录)
```

### 7.2 Hook 配置结构验证

```bash
$PYTHON_CMD -c "
import json
with open('$DEV_PROJECT/.claude/settings.json') as f:
    cfg = json.load(f)
hooks = cfg.get('hooks', {}).get('SessionEnd', [])
assert len(hooks) > 0, 'SessionEnd hooks 为空'
for i, h in enumerate(hooks):
    assert 'matcher' in h, f'Hook[{i}] 缺少 matcher'
    assert 'hooks' in h and isinstance(h['hooks'], list), f'Hook[{i}] 缺少嵌套的 hooks 数组'
    for j, inner in enumerate(h['hooks']):
        assert 'type' in inner, f'Hook[{i}].hooks[{j}] 缺少 type'
        assert 'command' in inner, f'Hook[{i}].hooks[{j}] 缺少 command'
print('OK: Hook 配置正确（嵌套结构）')
"
```

### 7.3 MCP 连通性

```bash
curl -s http://127.0.0.1:19828/health || echo "WARNING: llm_wiki API 未响应。确认应用在运行。"
```

### 7.4 Python 脚本预检

```bash
# 测试 capture_session.py 有正确的 Python 语法
$PYTHON_CMD -c "import py_compile; py_compile.compile('$WIKI_APP/experience-system/tools/capture_session.py', doraise=True)" && echo "OK: 语法正确"

# 测试 extract_experiences.py
$PYTHON_CMD -c "import py_compile; py_compile.compile('$WIKI_APP/tools/extract_experiences.py', doraise=True)" && echo "OK: 语法正确"
```

### 7.5 最小化 Hook 触发测试

```bash
# 模拟 Claude Code SessionEnd 的 stdin 输入
mkdir -p /tmp/hook-test
echo '{"session_id":"deploy-test-001","transcript_path":"/nonexistent","cwd":"'$DEV_PROJECT'"}' | $PYTHON_CMD $WIKI_APP/experience-system/tools/capture_session.py --stdin 2>&1
cat ~/.llm-wiki/capture_session.log | tail -5
```

预期输出中应有 `stdin 模式: session=deploy-test-001`。

---

## Phase 8 — 输出配置摘要

```
📋 配置摘要
━━━━━━━━━━━━━━━━━━━━━━━━
开发项目:   $PROJECT_NAME ($DOMAIN)
项目目录:   $DEV_PROJECT
Wiki 项目:  $WIKI_PROJECT
llm_wiki:   $WIKI_APP
Python:     $PYTHON_CMD
━━━━━━━━━━━━━━━━━━━━━━━━

✅ 配置完成。下次 Claude Code 启动时自动加载经验系统。
   手动测试: 在对话中输入 xp 测试
```

---

## 故障排查

### Hook 不触发（SessionEnd 后没有日志）

**症状:** 关闭 Claude Code 会话后 `capture_session.log` 无新记录。

**诊断步骤:**

1. **检查 Hook 是否注册:**
   ```bash
   cat $DEV_PROJECT/.claude/settings.json | $PYTHON_CMD -m json.tool
   ```
   确认 hooks.SessionEnd 存在且格式正确。

2. **验证最小化 Hook:**
   暂时替换为一个只写日志的简单 Hook:
   ```json
   {
     "hooks": {
       "SessionEnd": [{
         "matcher": "",
         "hooks": [{
           "type": "command",
           "command": "echo \"$(date): FIRED\" >> /tmp/hook-test.log 2>&1"
         }]
       }]
     }
   }
   ```
   启动 Claude Code → /exit → `cat /tmp/hook-test.log`。
   如果有 "FIRED" → Hook 机制正常，问题在 capture_session.py 路径或 Python。
   如果没有 → Hook 配置本身有问题，检查 JSON 格式。

3. **检查 Python 命令:**
   ```bash
   # 确认 settings.json 中的 command 可以直接在终端执行
   $PYTHON_CMD $WIKI_APP/experience-system/tools/capture_session.py --help
   ```

### `python` vs `python3` 问题

**症状:** Hook 日志显示 "command not found: python" (Linux) 或 "command not found: python3" (Windows)。

**解决:** 在 settings.json 的 command 中改为当前平台存在的命令:
- Linux/macOS: `python3`
- Windows: 尝试 `python3`，不行就用 `python`

### 经验提取失败（transcript 存档成功但没生成 wiki 页面）

**症状:** `capture_session.log` 显示 "经验提取失败" 或 "找不到 extract_experiences.py"。

**诊断:**
```bash
# 1. 检查 LLM_WIKI_ROOT 环境变量
echo $LLM_WIKI_ROOT

# 2. 检查 extract_experiences.py 位置
ls -la $WIKI_APP/tools/extract_experiences.py

# 3. 查看详细日志
cat ~/.llm-wiki/capture_session.log
```

**解决:**
- 如果在 settings.json 的 env 中设置了 `LLM_WIKI_ROOT`，确认路径正确
- 如果没设环境变量，确认 capture_session.py 中的自动推断能定位到 llm_wiki 仓库

### MCP 工具不可用

**症状:** Claude Code 中 `llm_wiki_search` 等工具不存在。

**诊断:**
```bash
# 1. llm_wiki 应用在运行吗？
curl http://127.0.0.1:19828/health

# 2. MCP 配置正确吗？
cat $HOME/.claude/.mcp.json | $PYTHON_CMD -m json.tool

# 3. MCP Server 入口文件存在吗？
ls -la $WIKI_APP/mcp-server/dist/src/index.js
```

**解决:**
- 应用未运行 → 启动 `npm run tauri dev`
- MCP 配置缺失 → 重新执行 Phase 6
- `dist/src/index.js` 不存在 → `cd $WIKI_APP/mcp-server && npm install && npm run build`

### Linux 特定问题

**cargo/rust 编译超时:**
```bash
# 配置清华镜像
mkdir -p ~/.cargo
cat > ~/.cargo/config.toml << 'EOF'
[source.crates-io]
replace-with = 'tuna'
[source.tuna]
registry = "https://mirrors.tuna.tsinghua.edu.cn/git/crates.io-index.git"
[net]
git-fetch-with-cli = true
EOF
```

**系统依赖缺失:**
```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev librsvg2-dev patchelf protobuf-compiler libssl-dev
```

### 卸载

如果用户想断开经验系统:
1. 删除 `$DEV_PROJECT/.claude/settings.json` 中的 `hooks.SessionEnd` 和 `env` 段
2. 删除 `$DEV_PROJECT/.claude/skills/xp.md`
3. 从 `$DEV_PROJECT/CLAUDE.md` 中删除「经验系统」段落
4. (可选) 从 `$HOME/.claude/.mcp.json` 中删除 `llm-wiki` 条目

---

## 已知限制

1. **SessionEnd Hook 依赖 llm_wiki 应用在线** — 如果应用没运行，经验提取到 `raw/sources/experiences/` 但不会被 Ingest 管线处理。下次启动应用后会自动处理积压文件。

2. **LLM 必须配置** — Ingest 管线需要 LLM 才能生成结构化 wiki 页面。如果 llm_wiki 中未配置 LLM Provider，源文件会积压在 `raw/sources/experiences/`。

3. **跨项目经验隔离依赖前端** — 经验页面有 `project` 和 `domain` 字段，但搜索 API 的 project 过滤尚未实现。多项目共用同一 wiki 时，搜索结果可能混入其他项目的经验。

4. **Python 脚本依赖仓库结构** — `capture_session.py` 通过相对路径定位 `extract_experiences.py`，依赖 `experience-system/` 和 `tools/` 在同一个仓库中的目录结构。如果移动文件，需设置 `LLM_WIKI_ROOT` 环境变量。

---

## 元数据

- **版本**: 2.0
- **日期**: 2026-06-25
- **变更**: 修复 Hook 格式（嵌套结构：matcher + hooks 包装）、Python 版本兼容、跨平台 python3 检测、自动路径推断
- **前置**: 首次部署需 llm_wiki 应用运行中；后续日常使用不需要
