# Agent Setup Guide — 经验系统自动配置

<!--
  目标读者: Claude Code (Agent), 不是人类。
  触发条件: 用户说 "配置知识库" / "接入经验系统" / "setup wiki" 等。
  行为: 按本文档步骤执行, 缺少信息时向用户提问。
-->

## 角色

你正在帮用户配置「项目经验自动积累系统」。你的任务是:
1. 收集必要信息
2. 创建/修改配置文件
3. 验证配置正确性
4. **不要跳过步骤, 不要假设默认值**

---

## Phase 0 — 定位资源

找到 llm_wiki 仓库（应用 + 部署配件都在同一个仓库里）。按以下顺序查找:

```
1. 当前 Claude Code 项目内: 检查目录是否同时包含 package.json、src-tauri/、experience-system/
2. 用户主目录: ~/work/llm_wiki/
3. 常见位置: ~/llm_wiki/、/opt/llm_wiki/
4. 已安装应用模式 — 按平台搜索稳定提取路径 (app_data_dir):
   - Linux:   ~/.local/share/com.llmwiki.app/
   - macOS:   ~/Library/Application Support/com.llmwiki.app/
   - Windows: %APPDATA%/com.llmwiki.app/
5. 已安装应用模式 — 按平台搜索安装目录 (resource_dir):
   - Linux deb:       /usr/lib/llm-wiki/
   - macOS:           /Applications/LLM Wiki.app/Contents/Resources/
   - Windows MSI/NSIS: C:/Program Files/LLM Wiki/
6. 问用户: "llm_wiki 安装在哪个目录?"
```

找到后记录仓库根目录为 `$WIKI_APP`，部署配件目录为 `$PKG = $WIKI_APP/experience-system/`。

**验证清单 (源码模式, 步骤 1-3 命中时):**
- `$WIKI_APP/package.json` 存在
- `$WIKI_APP/src-tauri/` 存在
- `$PKG/config/settings.json` 存在
- `$WIKI_APP/mcp-server/dist/src/index.js` 存在。如果不存在, 执行:
  ```bash
  cd $WIKI_APP/mcp-server && npm install && npm run build
  ```

**验证清单 (已安装应用模式, 步骤 4-5 命中时):**
- `$PKG/tools/capture_session.py` 存在 (注意: 安装模式下路径不含 `../` 回退)
- `$WIKI_APP/mcp-server/dist/src/index.js` 存在

> **说明:** `$WIKI_APP` 和 `$PKG` 在同一个仓库中，不需要分别查找。`$PKG` 永远是 `$WIKI_APP/experience-system/`。

---

## Phase 1 — 收集信息

按顺序向用户收集以下信息。**原则: 一次问一个问题, 等用户回答后再问下一个。**

### 1.1 开发项目名

```
问: "你的开发项目叫什么名字? (用于经验标记来源, 如 smart-lock-firmware)"
```

记录为 `$PROJECT_NAME`。必须非空。

### 1.2 技术领域

```
问: "这个项目的技术领域是什么? (如 embedded-arm, web-frontend, rust-backend)"
```

记录为 `$DOMAIN`。如果用户不知道, 从项目文件推断 (如 `package.json` / `Cargo.toml` / 项目目录名), 推断不出则用 `general`。

### 1.3 开发项目根目录

```
当前 Claude Code 工作目录通常就是开发项目根目录。
问: "你的开发项目在哪个目录? "
```

记录为 `$DEV_PROJECT`。设为当前工作目录的绝对路径。

### 1.4 Wiki 项目位置

```
问: "经验存储到哪个 wiki?"
选项:
  A) 创建新 wiki 项目 (需要先启动 llm_wiki 应用)
  B) 已有 wiki 项目 — 告诉我路径
```

- 选 A: 跳到 Phase 2 创建 wiki
- 选 B: 记录用户给的路径为 `$WIKI_PROJECT`, 验证路径存在且有 `wiki/` 子目录

---

## Phase 2 — 创建 Wiki 项目 (仅当 Phase 1.4 选 A)

### 2.1 启动 llm_wiki

```bash
cd $WIKI_APP && npm run tauri dev
```

这是后台进程。等待 30-60 秒让应用窗口弹出。

### 2.2 引导用户创建项目

告诉用户:
```
请在 llm_wiki 窗口中操作:
1. 点击 "New Project" 或 "新建项目"
2. 项目名 → 填: $PROJECT_NAME-experiences (或你喜欢的名字)
3. 模板 → 选择 "Experience (🧠)"
4. 父目录 → 选择一个合适的目录
5. 点击 "Create"
6. 创建完成后, 把项目的完整路径告诉我
```

等用户回复后, 记录为 `$WIKI_PROJECT`。

---

## Phase 3 — 配置开发项目

### 3.1 创建目录结构 + 检测 Python 命令

```bash
mkdir -p $DEV_PROJECT/.claude/skills
```

**检测 Python 命令**（不同平台不同——Ubuntu 只有 `python3`，Windows 两者都有）:

```bash
if command -v python3 &>/dev/null; then
  PYTHON_CMD="python3"
elif command -v python &>/dev/null; then
  PYTHON_CMD="python"
else
  echo "ERROR: Python 3 未安装"
fi
echo "Python 命令: $PYTHON_CMD"
```

> 后续所有用到 `python` 的地方都用 `$PYTHON_CMD` 替代。

### 3.2 复制并填充 settings.json

```bash
cp $PKG/config/settings.json $DEV_PROJECT/.claude/settings.json
```

然后把其中的占位符替换为实际值:

| 占位符 | 替换为 | 说明 |
|--------|--------|------|
| `<你的项目名>` | `$PROJECT_NAME` | |
| `<技术领域>` | `$DOMAIN` | |
| `<llm_wiki 安装目录>` | `$WIKI_APP` | 用正斜杠 `/` |
| `<experience-system>` | `$PKG` | 用正斜杠 `/` |
| `<你的wiki项目>` | `$WIKI_PROJECT` | 用正斜杠 `/` |

**关键**: Windows 路径必须用正斜杠 `/` 或双反斜杠 `\\`, 绝不能是单反斜杠 `\`。

### 3.2b 验证 Hook 格式 (重要!)

替换后必须验证 settings.json 是嵌套格式（`matcher` + `hooks` 包装）:

```bash
python3 -c "
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

### 3.2c 备选：直接写入（模板格式不对时使用）

如果模板验证失败，直接写入 `$DEV_PROJECT/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionEnd": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "$PYTHON_CMD $PKG/tools/capture_session.py --stdin"
      }]
    }]
  },
  "env": {
    "LLM_WIKI_PROJECT": "$PROJECT_NAME",
    "LLM_WIKI_DOMAIN": "$DOMAIN",
    "LLM_WIKI_ROOT": "$WIKI_APP",
    "LLM_WIKI_OUTPUT_DIR": "$WIKI_PROJECT/raw/sources/experiences"
  }
}
```

> `$PYTHON_CMD` — 先检测 `python3` 是否存在，不存在则用 `python`。Linux (Ubuntu) 上只有 `python3`。

### 3.3 写入 CLAUDE.md

检查 `$DEV_PROJECT/CLAUDE.md` 是否已存在:

| 存在? | 操作 |
|-------|------|
| ❌ 不存在 | 写入完整模板 (见下方完整模板), 将 `$WIKI_PROJECT` 替换为实际路径 |
| ✅ 存在 | 读取现有内容, **追加**经验系统段落 (见下方追加模板), 不要覆盖已有内容 |

两种模板都包含 6 步情境加载 + 自动搜索 + 手动标记。

#### 完整模板 (项目尚无 CLAUDE.md 时使用)

写入 `$DEV_PROJECT/CLAUDE.md`:

```markdown
# KB-Loader: skip

本项目使用外部经验系统 (wiki 项目: $WIKI_PROJECT)，经验通过 SessionEnd Hook 自动汇入。

## 经验系统

### 知识库位置
- Wiki 项目: $WIKI_PROJECT
- 通过 MCP `llm_wiki_search` 搜索经验

### 会话启动: 项目情境加载

启动时, 按顺序执行以下步骤组装项目情境:

**Step 1 — 项目身份**
用 `llm_wiki_read_file` 读取 `wiki/purpose.md`，获取项目名、技术栈、当前关注点。

**Step 2 — 近期动态**
用 `llm_wiki_read_file` 读取 `wiki/log.md` 最近的 5 条记录，了解上次会话做了什么。

**Step 3 — 待解决问题**
用 `llm_wiki_files` 列出 `wiki/bugs/`，逐个用 `llm_wiki_read_file` 读取 frontmatter，筛选 status=unresolved。

**Step 4 — 待定决策**
用 `llm_wiki_files` 列出 `wiki/decisions/`，逐个用 `llm_wiki_read_file` 读取 frontmatter，筛选 status=proposed。

**Step 5 — 开发上下文 (可选)**
`git branch` + `git status`，与 Step 1-4 的情境交叉比对。

**Step 6 — 输出情境摘要**

按以下格式告知用户:

📋 **项目情境加载完成**

**项目:** <项目名> (<技术栈>)
**阶段:** <当前关注点>
**上次会话:** YYYY-MM-DD — <最近 log>

⚠️ **待解决:** N bugs / M decisions 待定
- [[bug-slug]] — 一句话描述 (日期)
- [[decision-slug]] — 一句话描述 (日期)

📌 **相关经验:** (基于 git 上下文自动搜索)

### 自动搜索
遇到以下情况时, 主动通过 MCP `llm_wiki_search` 搜索知识库:
- 编译/运行时错误 (含 error、failed、panic、cannot、undefined is not 等)
- 配置文件不生效、格式错误
- 环境依赖问题 (找不到工具、版本不兼容)
- 重复性工作 (用户说"上次怎么做的"、"又遇到这个")

搜索到相关经验时, 告知用户: ⚠️ 知识库有相关经验: [[PageName]] — 摘要
无匹配时继续正常排错, 问题解决后确认是否产生新经验。

### 手动标记
- `xp` — 由 Skill 拦截 (`.claude/skills/xp.md`)，只输出轻量标记，不写文件
- "提炼经验" / "记录这个坑" — 同样只做标记

标记后的经验会在会话结束时由 Ingest 管线自动生成完整页面。
```

#### 追加模板 (项目已有 CLAUDE.md 时使用)

读取 `$DEV_PROJECT/CLAUDE.md`，在文件末尾追加:

```markdown

## 经验系统

本项目使用外部经验系统。

### 知识库位置
- Wiki 项目: $WIKI_PROJECT
- 通过 MCP `llm_wiki_search` 搜索经验

### 会话启动: 项目情境加载

启动时, 按顺序执行以下步骤组装项目情境:

**Step 1 — 项目身份**
用 `llm_wiki_read_file` 读取 `wiki/purpose.md`，获取项目名、技术栈、当前关注点。

**Step 2 — 近期动态**
用 `llm_wiki_read_file` 读取 `wiki/log.md` 最近的 5 条记录，了解上次会话做了什么。

**Step 3 — 待解决问题**
用 `llm_wiki_files` 列出 `wiki/bugs/`，逐个用 `llm_wiki_read_file` 读取 frontmatter，筛选 status=unresolved。

**Step 4 — 待定决策**
用 `llm_wiki_files` 列出 `wiki/decisions/`，逐个用 `llm_wiki_read_file` 读取 frontmatter，筛选 status=proposed。

**Step 5 — 开发上下文 (可选)**
`git branch` + `git status`，与 Step 1-4 的情境交叉比对。

**Step 6 — 输出情境摘要**

按以下格式告知用户:

📋 **项目情境加载完成**

**项目:** <项目名> (<技术栈>)
**阶段:** <当前关注点>
**上次会话:** YYYY-MM-DD — <最近 log>

⚠️ **待解决:** N bugs / M decisions 待定
- [[bug-slug]] — 一句话描述 (日期)
- [[decision-slug]] — 一句话描述 (日期)

### 自动搜索
遇到以下情况时, 主动通过 MCP `llm_wiki_search` 搜索知识库:
- 编译/运行时错误 (含 error、failed、panic、cannot、undefined is not 等)
- 配置文件不生效、格式错误
- 环境依赖问题 (找不到工具、版本不兼容)
- 重复性工作 (用户说"上次怎么做的"、"又遇到这个")

搜索到相关经验时, 告知用户: ⚠️ 知识库有相关经验: [[PageName]] — 摘要
无匹配时继续正常排错, 问题解决后确认是否产生新经验。

### 手动标记
- `xp` — 由 Skill 拦截, 轻量标记
- "提炼经验" / "记录这个坑" — 同样只做标记
```

### 3.4 复制 Skill

```bash
cp $PKG/skills/xp.md $DEV_PROJECT/.claude/skills/xp.md
```

### 3.5 配置 MCP

**先检测 node 的绝对路径**（Claude Code 启动 MCP 子进程时不继承终端 PATH，相对路径可能找不到）:

```bash
# Windows PowerShell
NODE_PATH=$(powershell.exe -Command "Get-Command node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source" 2>/dev/null)

# Linux / macOS
if [ -z "$NODE_PATH" ]; then
  NODE_PATH=$(which node 2>/dev/null || echo "")
fi

echo "Node 路径: $NODE_PATH"
```

如果以上都找不到，问用户 `node` 装在哪里。

**使用 `claude mcp add` 命令注册 MCP Server**（不要手动编辑 `.mcp.json` — Claude Code 实际配置文件是 `$HOME/.claude.json`，项目级 MCP 配置存储在各项目的 `mcpServers` 字段下）:

```bash
claude mcp add llm-wiki -- "$NODE_PATH" "$WIKI_APP/mcp-server/dist/src/index.js"
```

这会将 `llm-wiki` 添加到当前项目的 MCP 配置中（写入 `$HOME/.claude.json` 的 `projects.<当前项目路径>.mcpServers`）。

> **注意:** Claude Code 不使用 `$HOME/.claude/.mcp.json`。该文件即使存在也不会被读取。始终用 `claude mcp add` 或直接编辑 `$HOME/.claude.json`。

### 3.6 确认 Hook 触发条件

经验系统需要每次会话结束都触发 Hook。SessionEnd 使用标准嵌套格式：`matcher: ""` + `hooks: [...]` 包装（`/doctor` 要求的格式）。`matcher` 为空字符串表示匹配所有操作。

无需询问用户——经验系统永远使用全量捕获。直接跳到 Phase 4。

---

## Phase 4 — 验证

按顺序执行以下检查:

### 4.1 文件存在性

```
✅ $DEV_PROJECT/.claude/settings.json
✅ $DEV_PROJECT/.claude/skills/xp.md
✅ $DEV_PROJECT/CLAUDE.md (含经验系统段落)
✅ $HOME/.claude/.mcp.json (含 llm-wiki 条目)
```

### 4.2 占位符检查

```bash
grep '<你的\|llm_wiki安装\|experience-system\|你的wiki' $DEV_PROJECT/.claude/settings.json
```

如果有输出 → 替换未完成, 回去重做。

### 4.3 MCP 连通性检查

```bash
curl -s http://127.0.0.1:19828/health || echo "WARNING: llm_wiki API 未响应"
```

如果 API 未响应:
- llm_wiki 应用是否在运行?
- 端口 19828 是否被占用?

### 4.4 输出配置摘要

告诉用户配置完成, 展示:
```
📋 配置摘要
━━━━━━━━━━━━━━━━━━━━━━━━
开发项目:   $PROJECT_NAME ($DOMAIN)
项目目录:   $DEV_PROJECT
Wiki 项目:  $WIKI_PROJECT
llm_wiki:   $WIKI_APP
━━━━━━━━━━━━━━━━━━━━━━━━

✅ 所有检查通过。下次 Claude Code 启动时会自动加载经验系统。
   手动测试: 在对话中输入 xp 测试一下
```

---

## Phase 5 — 错误处理与回退

### 常见问题

| 症状 | 诊断 | 解决 |
|------|------|------|
| `xp` 不识别 | Skill 文件路径不对 | 检查 `.claude/skills/xp.md` 存在且有 YAML frontmatter |
| MCP 搜索无响应 | llm_wiki 未运行 | 启动 `$WIKI_APP`: `npm run tauri dev` |
| SessionEnd 无输出 | Hook 路径错误 | 检查 settings.json 中 `command` 路径是否可访问 |
| 经验未入库 | extract_experiences.py 读取失败 | 查看 `$WIKI_APP/tools/extract_experiences.py` 日志 |
| KB-Bootstrap 干扰 | 全局 CLAUDE.md 加载了其他知识库 | 检查 `$HOME/.claude/CLAUDE.md`, 如不需要则清空 |

### 卸载

如果用户想断开经验系统:
1. 删除 `$DEV_PROJECT/.claude/settings.json` 中的 `hooks.SessionEnd` 段
2. 删除 `$DEV_PROJECT/.claude/settings.json` 中的 `env` 段
3. 删除 `$DEV_PROJECT/.claude/skills/xp.md`
4. 从 `$DEV_PROJECT/CLAUDE.md` 中删除「经验系统」段落
5. (可选) 从 `$HOME/.claude/.mcp.json` 中删除 `llm-wiki` 条目

---

## 元数据

- **版本**: 1.0
- **日期**: 2026-06-16
- **适用**: Claude Code + experience-system 部署包
- **维护**: 更新本文件时, 同步更新 `$PKG/README.md`
