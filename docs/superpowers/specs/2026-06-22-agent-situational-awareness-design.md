# Agent 启动情境感知 — 设计文档

> **版本:** 1.0 | **日期:** 2026-06-22 | **状态:** 设计中

---

## 一、问题定义

### 当前行为

Claude Code 启动时，CLAUDE.md 指令让 Agent 执行一次关键词搜索（项目名 + 领域名），返回 top 5 随机相关经验。

### 问题

- 搜索结果**随机**——可能返回 3 条 bug + 1 条 howto + 1 条 decision，跟项目当前状态无关
- Agent 不知道"这个项目现在处于什么阶段""有什么未解决的问题""有什么待定的决策"
- overview.md 是静态模板，创建后从未更新

### 目标

将启动行为从**"记忆召回"**升级为**"情境感知"**：

> Agent 启动时自动组装项目当前状态：身份 → 进度 → 待办 → 待定 → 上下文关联经验

---

## 二、设计方案

### 2.1 总体思路

**不改架构，只改数据格式 + Agent 指令。** 核心原则：Agent 自己组装情境，不依赖固定的 status.md 文件。

数据层面做 3 件事：
1. Frontmatter 增加 `status` 字段（让 Agent 能过滤未解决/待定项）
2. Log 格式标准化（让 Agent 能读近期动态）
3. Ingest prompt 增加 status 推断指令（让 LLM 自动填 status）

指令层面做 1 件事：
4. CLAUDE.md 启动段落重写（让 Agent 分步组装情境）

### 2.2 Frontmatter `status` 字段

#### bug

```yaml
---
type: bug
status: unresolved | resolved | cannot-reproduce | wont-fix
resolution: ""  # 仅 resolved 时填写，一句话描述修复方式
---
```

#### decision

```yaml
---
type: decision
status: proposed | accepted | deprecated | superseded
superseded_by: ""  # 仅 superseded 时填写，指向替代决策 slug
---
```

#### 其他类型

howto / agent-error / pattern / template 不加 status 字段。howto 和 template 是静态知识，pattern 存在即成立。

### 2.3 Log 格式标准化

#### 旧格式

```markdown
## 2026-06-22

- ingest | session transcript processed
```

#### 新格式

```markdown
## 2026-06-22

**Session:** <一句话描述本次会话做了什么>

- Fixed [[slug]] — <一句话>
- New [[slug]] — <一句话>
- Linked [[slug]] → pattern — <一句话>
```

#### 动词前缀

| 前缀 | 含义 | 适用类型 |
|------|------|---------|
| `Fixed` | 已解决 | bug |
| `New` | 新创建 | bug / decision / howto / agent-error / pattern / template |
| `Linked` | 关联升级 | bug → pattern |
| `Updated` | 内容变更 | 任何 |
| `Deprecated` | 已废弃 | decision |
| `In progress` | 进行中 | 手动写入 |

### 2.4 Ingest Prompt 改造

#### Stage 1 — buildAnalysisPrompt 增加

```markdown
### Status Detection

For each potential experience, determine its project status:

**Bug:**
- `unresolved` — 问题在当前 session 中未被解决，只是发现了
- `resolved` — 问题已修复，有明确的修复方法
- `cannot-reproduce` — 环境差异导致无法复现
- `wont-fix` — 有意选择不修（如成本过高、不是真正的 bug）

**Decision:**
- `proposed` — 提出了选项但还未做出选择
- `accepted` — 已做出决定并正在执行
- `deprecated` — 曾经使用但不再适用
- `superseded` — 被更晚的决策替代（需注明替代者）

Default: bug → unresolved, decision → accepted
```

#### Stage 2 — buildGenerationPrompt 增加

```markdown
### Frontmatter Requirements

- For `type: bug`, always include `status` and `resolution` fields.
- For `type: decision`, always include `status` field.
- Other types: no status field needed.

### Log Format

After generating all FILE blocks, append a `file:wiki/log.md` block that records this session's activity. Use these prefixes:
- `Fixed [[slug]]` for resolved bugs
- `New [[slug]]` for newly created pages
- `Linked [[slug]] → pattern` when a bug strengthens a pattern

Keep each entry to one line with a brief description.
```

### 2.5 CLAUDE.md 启动指令

```markdown
### 会话启动：项目情境加载

启动时，按顺序执行以下步骤组装项目情境：

**Step 1 — 项目身份**
读取 wiki/purpose.md，获取项目名、技术栈、当前关注点。

**Step 2 — 近期动态**
读取 wiki/log.md 最近的 5 条记录，了解上次会话做了什么。

**Step 3 — 待解决问题**
列出 wiki/bugs/ 目录，逐个读取 frontmatter，筛选 status=unresolved。
如果有未解决 bug，按 created 日期排序，优先展示最近的。

**Step 4 — 待定决策**
列出 wiki/decisions/ 目录，逐个读取 frontmatter，筛选 status=proposed。
如果有待定决策，告知用户"还有 N 个决策未定"。

**Step 5 — 开发上下文（可选）**
如果可以从 git branch / git status 获取当前开发项目状态，
将 git 信息与 Step 1-4 的情境交叉比对：
- 当前 branch 名是否匹配已有的 decision 或 bug？
- 最近修改的文件是否涉及已知的 pattern？

**Step 6 — 输出情境摘要**

按以下格式告知用户：

📋 **项目情境加载完成**

**项目:** <项目名> (<技术栈>)
**阶段:** <当前关注点>
**上次会话:** YYYY-MM-DD — <最近 log>

⚠️ **待解决:** N bugs / M decisions 待定
- [[bug-slug]] — 一句话描述 (日期)
- [[decision-slug]] — 一句话描述 (日期)

📌 **相关经验:** 基于当前上下文，以下经验可能有用
- [[slug]] — 一句话描述
```

## 三、改动清单

| # | 文件 | 改动 | 量 |
|:--:|------|------|:--:|
| 1 | `src/lib/templates.ts` | Experience schema 段加 `status` 字段说明；purpose.md 模板补全字段 | ~15 行 |
| 2 | `src/lib/ingest.ts` | `buildAnalysisPrompt` + `buildGenerationPrompt` 加 status 推断和 log 格式指令 | ~15 行 prompt 文本 |
| 3 | `src/lib/ingest.prompt.test.ts` | 更新 prompt 快照测试 | ~3 行 |
| 4 | `experience-system/config/CLAUDE.md` | 替换"会话启动"段 | 替换段落 |

**总代码量：** ~30 行 TypeScript + 3 个 markdown 块。架构零改动。

## 四、启动时 Agent 行为伪代码

```
async function loadProjectContext() {
  // Step 1: 身份
  const purpose = await mcpRead("wiki/purpose.md")

  // Step 2: 动态
  const log = await mcpRead("wiki/log.md")
  const recentLogs = extractLast5Entries(log)

  // Step 3: 待修
  const bugFiles = await mcpList("wiki/bugs/")
  const unresolved = []
  for (const f of bugFiles) {
    const content = await mcpRead(f.path)
    const fm = parseFrontmatter(content)
    if (fm.status === "unresolved") unresolved.push({ slug: f.name, ...fm })
  }

  // Step 4: 待定
  const decisionFiles = await mcpList("wiki/decisions/")
  const proposed = []
  for (const f of decisionFiles) {
    const content = await mcpRead(f.path)
    const fm = parseFrontmatter(content)
    if (fm.status === "proposed") proposed.push({ slug: f.name, ...fm })
  }

  // Step 5: Git 交叉比对（可选）
  let gitContext = null
  try {
    const branch = exec("git branch --show-current")
    gitContext = crossMatch(branch, unresolved, proposed)
  } catch {}

  // Step 6: 输出
  printSummary({ purpose, recentLogs, unresolved, proposed, gitContext })
}
```

## 五、未改的部分

- 会话中自动搜索触发规则不变
- /exp Skill 逻辑不变
- SessionEnd Hook → extract → ingest 链路不变
- 向量嵌入机制不变
- 搜索架构（BM25 + 向量 + RRF）不变
- Schema 校验逻辑不变

## 六、验证方式

1. 用已有 wiki 项目，手动给现有 bug/decision 页面加 `status` 字段
2. 模拟启动 CLAUDE.md 指令：手动执行 Step 1-6，看组装结果
3. 触发一次 ingest：确认新生成的页面 frontmatter 含 `status` 字段
4. 检查 log.md：确认新格式含 `[[wikilink]]` + 动词前缀
