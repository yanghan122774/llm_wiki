# 经验系统 — 完整部署包

**版本:** 1.0 | **日期:** 2026-06-16

---

## 一、这是什么

一个给 Claude Code 用的**项目经验自动积累系统**。你在写代码过程中踩的坑、做的技术决策、发现的 bug，会话结束后自动提取、结构化存储到 wiki 知识库。下次碰到类似问题，Claude 自动搜索并提醒你。

**一句话：** 经验不会随着会话结束而丢失。

---

## 二、你需要什么

| 组件 | 已包含？ | 说明 |
|------|---------|------|
| llm_wiki 应用 | ✅ 本仓库根目录 | 知识库管理桌面应用（Tauri + React），提供 API + Ingest 管线 |
| 部署配置 | ✅ 本包 `config/` `tools/` `skills/` | SessionEnd Hook、/exp Skill、经验提取脚本 |
| Claude Code | ❌ 需自行安装 | AI 编程助手 |

---

## 三、部署步骤

### Step 1：安装 llm_wiki 应用

```bash
# 1. 安装前端依赖
cd llm_wiki仓库根目录
npm install

# 2. 安装 MCP Server 依赖
cd mcp-server
npm install
npm run build

# 3. 返回根目录，启动应用
cd ..
npm run tauri dev
```

> 第一次 `npm install`（主项目）可能需要 3-5 分钟。之后日常使用只需 `npm run tauri dev`。
>
> 如遇 Tauri 构建错误，需安装 [Rust](https://rustup.rs/) 和 [Tauri 系统依赖](https://v2.tauri.app/start/prerequisites/)。

### Step 2：在 llm_wiki 中创建 wiki 项目

1. 打开 llm_wiki 应用
2. 新建项目 → 选择 **Experience（🧠）** 模板
   或使用本包的 `wiki-template/` 作为项目基础
3. 记下项目路径（如 `D:\work\my-experiences`）

### Step 3：配置开发项目

**推荐方式 — Agent 自动配置：**

把仓库根目录的 `docs/superpowers/agent-setup-guide.md` 发给 Claude Code，它会引导你按步骤完成所有配置（收集信息、写入 CLAUDE.md、配置 Hook、验证 MCP 连通性）。

**手动方式：**

去你的开发项目根目录（写代码的项目），复制以下文件：

```
本包/config/settings.json  →  <开发项目>/.claude/settings.json
本包/config/.mcp.json      →  C:\Users\<你的用户名>\.claude\.mcp.json  （全局 MCP 配置）
本包/skills/exp.md         →  <开发项目>/.claude/skills/exp.md
```

然后修改 `settings.json` 中的占位符：

| 占位符 | 改成什么 |
|--------|---------|
| `<你的项目名>` | 开发项目名，如 `smart-lock-firmware` |
| `<技术领域>` | 如 `embedded-arm`、`web-frontend` |
| `<llm_wiki 安装目录>` | 如 `D:/work/llm_wiki` |
| `<你的wiki项目>` | Step 2 创建的 wiki 项目路径 |
| `<experience-system>` | 本部署包的路径，如 `D:/work/experience-system` |

CLAUDE.md 由 Agent 按 `agent-setup-guide.md` Phase 3.3 自动生成，无需手动复制。

### Step 4：配置全局 MCP

把 `config/.mcp.json` 的内容合并到 `C:\Users\<你的用户名>\.claude\.mcp.json`（如果已有则追加 `llm-wiki` 条目）。

### Step 5：部署工具脚本

```bash
# 把 capture_session.py 中的路径改为你的实际路径
# 编辑 tools/capture_session.py，修改：
#   LLM_WIKI_ROOT 默认值 → 你的 llm_wiki 安装目录
```

---

## 四、文件结构

```
llm_wiki/                         ← 仓库根目录
├── src/                          # React 前端 + Ingest 管线
├── src-tauri/                    # Rust 后端 (Tauri commands)
├── mcp-server/                   # MCP Server (Node.js)
├── tools/                        # extract_experiences.py
├── docs/                         # 设计文档 + agent-setup-guide.md
├── package.json                  # npm install 入口
├── experience-system/            ← 本目录（部署配件）
│   ├── README.md                 ← 你正在读的文件
│   ├── config/                   ← 配置模板（复制到开发项目）
│   │   ├── settings.json         # SessionEnd Hook + 环境变量
│   │   └── .mcp.json             # MCP Server 配置
│   ├── skills/                   ← Skill 文件
│   │   └── exp.md                # /exp 手动标记经验
│   ├── tools/                    ← 工具脚本（Hook 入口）
│   │   └── capture_session.py    # SessionEnd Hook 入口
│   └── wiki-template/            ← Wiki 项目模板
│       ├── schema.md             # 定义 6 种经验类型
│       └── purpose.md            # 项目目的（需填写）
```
```

---

## 五、日常使用

### 会话启动
启动时 Claude 自动执行 6 步情境加载：读取项目身份 → 近期动态 → 待解决 bugs → 待定 decisions → Git 交叉比对 → 输出情境摘要。

### 会话中
碰到以下情况，Claude 主动搜索知识库：
- 编译/运行时错误
- 配置不生效
- 环境依赖问题
- 重复性工作

### 手动标记
```
/exp 刚才那个 xxx 的坑
```
只输出几行标记，不打断工作，会话结束后自动入库。

### 会话结束
Hook 自动触发：transcript → 提取经验 → wiki 页面生成 → 向量嵌入 → 可搜索。

---

## 六、经验类型

| Type | 目录 | 用途 |
|------|------|------|
| bug | wiki/bugs/ | 缺陷：现象→根因→解决→预防 |
| decision | wiki/decisions/ | 决策：背景→方案→决策→后果 |
| howto | wiki/howto/ | 操作：目的→前提→步骤→验证 |
| agent-error | wiki/agent-errors/ | Claude 的错误及纠正 |
| pattern | wiki/patterns/ | 重复出现的坑（需≥2条证据） |
| template | wiki/templates/ | 可复用的检查清单 |

---

## 七、架构

```
Claude Code 会话
  │
  ├─ CLAUDE.md 规则 → 会话中自动搜索 MCP
  ├─ /exp Skill → 轻量标记
  └─ SessionEnd Hook → capture_session.py
        │
        ▼
  extract_experiences.py → raw/sources/experiences/*.md
        │
        ▼
  llm_wiki Source Watch → Ingest 管线（LLM 分析+生成）
        │
        ▼
  wiki/bugs/ + wiki/decisions/ + wiki/howto/ + ...
        │
        ▼
  向量嵌入 → LanceDB → 搜索 API → MCP llm_wiki_search
```

---

## 八、常见问题

**Q: 一定要 llm_wiki 运行着吗？**
是的。经验入库、搜索都依赖 llm_wiki 的 API。

**Q: 可以多项目共用一个 wiki 吗？**
可以。settings.json 中 `LLM_WIKI_PROJECT` 填各自项目名，`LLM_WIKI_OUTPUT_DIR` 指向同一个 wiki。

**Q: 经验质量不好怎么办？**
可在 llm_wiki 中直接编辑或删除页面。Ingest 管线有三层校验（prompt引导+schema约束+去重）。

**Q: /exp 和自动提取有什么区别？**
`/exp` 是你主动标记"这个重要"，自动提取是 SessionEnd 全量分析 transcript。两者互补。

**Q: 导入文件后只存到 Source，没生成 wiki 页面？**
检查两点：
1. 文件路径必须包含 `experiences/` 或 `sessions/` — 如 `raw/sources/experiences/xxx.md`。放在 `raw/sources/` 根目录会走通用管线，不生成经验页面。
2. 超长会话（transcript > 100KB）可能导致 LLM 输出 token 不够用，只生成索引不生成页面。解决：拆成多次小会话，或给 LLM 配更大的 `maxContextSize`。

**Q: 如何快速自动配置？**
把 `agent-setup-guide.md`（本包根目录）给 Claude Code 读，它会按步骤引导配置。不需要手动填占位符。
