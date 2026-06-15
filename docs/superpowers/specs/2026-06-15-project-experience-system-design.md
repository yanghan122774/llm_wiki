# 项目经验积累系统 — 设计文档

**日期：** 2026-06-15
**状态：** 草案
**背景：** 将 llm_wiki 改造为能自动捕获、结构化存储、主动检索项目经验（踩坑、bug、决策）的系统，贯穿 Claude Code 会话全生命周期。

---

## 一、问题陈述

### 1.1 现状

llm_wiki 已有一条完整的流水线：

- **SessionEnd Hook** → 归档 Claude Code 会话 transcript 为 JSONL → 转 Markdown
- **Source Watch** → 监控 `raw/sources/` 目录，检测新文件 → 触发自动 Ingest
- **Ingest Pipeline** → MinerU/LLM 分析 → FILE 块解析 → wiki 页面生成 → 向量嵌入 → LanceDB
- **Search** → BM25 关键词 + 向量 ANN，RRF 融合排序
- **MCP Server** → 8 个工具，连接 Claude Code 与 llm_wiki API

### 1.2 差距

| 现状 | 目标 |
|------|------|
| Transcript 只做"归档"，不做分析提炼 | Transcript 被深度挖掘，提取结构化经验 |
| 无项目上下文 — 所有页面全局共享 | 每条经验标注 `project`（来源项目）+ `domain`（技术领域） |
| 搜索是全局的 | 搜索结果按项目/领域加权，靠近当前项目 |
| 被动 — 用户必须手动查询 | 主动 — 碰到错误自动搜，会话启动预加载 |
| 通用 Ingest prompt | 经验专用 prompt，专门提取 bug/decision/pattern |

### 1.3 成功标准

1. 每次 Claude Code 会话结束后，自动生成结构化经验页面
2. Claude Code 碰到错误时，主动搜索知识库中的相关经验
3. 会话启动时，根据当前项目上下文预加载相关经验
4. 同一根因出现 ≥2 次时，自动发现跨项目模式

---

## 二、设计决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 触发机制 | 三层全要：手动查询 + Stop Hook 自动检测 + 会话启动预加载 | 各司其职，覆盖不同场景 |
| 项目粒度 | 双层标注：`project`（来源仓库）+ `domain`（技术领域） | 兼顾项目内精确匹配和跨项目泛化搜索 |
| 经验类型 | 六种：bug、decision、howto、agent-error、**pattern**（模式）、**template**（模板） | pattern = 重复出现的坑 + 证据链；template = 可复用的项目检查清单 |
| 存储方式 | 集中式 — 所有经验存在同一个 llm-wiki 项目中，靠 frontmatter 字段区分 | 管理简单，跨项目搜索自然 |
| 提炼方式 | 脚本自动提取 + 手动 `/exp` 命令 | 自动化保吞吐量，手动保精准度 |
| 自动检测 | 关键词匹配（快）+ 模型自我判断（准） | 分层判断，不浪费 token |
| 实施顺序 | 第一阶段（最小改动）→ 第二阶段（经验专用 Ingest）→ 第三阶段（模式挖掘+加权搜索，延后） | 先跑通流程验证价值，再深入改造核心管线 |

---

## 三、架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                      Claude Code 会话                             │
│                                                                  │
│  SessionStart ──► 预加载相关经验（按 project + domain）           │
│       │                                                          │
│       ▼                                                          │
│  会话进行中 ──► 检测到错误？ ──► 通过 MCP 自动搜索知识库          │
│       │                                                          │
│       ▼                                                          │
│  SessionEnd ──► Hook：归档 transcript + 提取经验                  │
│       │                                                          │
│       ▼                                                          │
│  extract_experiences.py ──► LLM 提取结构化经验                    │
│       │                                                          │
│       ▼                                                          │
│  raw/sources/experiences/ ──► Source Watch 检测到新文件            │
│       │                                                          │
│       ▼                                                          │
│  Ingest Pipeline（第二阶段：经验分支）                              │
│       │                                                          │
│       ▼                                                          │
│  wiki/bugs/ + wiki/decisions/ + wiki/patterns/ + ...             │
│       │                                                          │
│       ▼                                                          │
│  向量嵌入 → LanceDB → 搜索 API（第三阶段：领域加权）               │
└─────────────────────────────────────────────────────────────────┘
```

### 3.1 组件关系图

```
┌──────────────┐    ┌──────────────────┐    ┌─────────────────┐
│ Claude Code  │───►│ extract_experien-│───►│ llm_wiki        │
│ SessionEnd   │    │ ces.py（新增）    │    │ Ingest Pipeline │
│ Hook         │    │                  │    │                 │
└──────────────┘    │ 用经验专用 prompt │    │ 第二阶段：      │
                     │ 调用 LLM          │    │ experience-     │
┌──────────────┐    │                  │    │ prompt.ts       │
│ Claude Code  │    │ 输出 → .md 文件   │    │                 │
│ SessionStart │    │ 放入 raw/sources/ │    │ 生成 bug/       │
│ Hook         │───►│ experiences/     │───►│ decision/       │
│              │    └──────────────────┘    │ pattern 页面     │
│ 预加载相关   │                             └────────┬────────┘
│ 经验         │    ┌──────────────────┐              │
└──────────────┘    │ sweep-patterns   │              ▼
                     │ .ts（第三阶段）  │    ┌─────────────────┐
┌──────────────┐    │                  │◄───│ wiki/bugs/      │
│ Claude Code  │    │ 跨会话模式挖掘： │    │ wiki/decisions/ │
│ 错误检测     │───►│ 同一根因 ≥2 次   │    │ wiki/patterns/  │
│ (Stop Hook)  │    │ → 自动创建       │    │ wiki/templates/ │
│              │    │   pattern 页面    │    └────────┬────────┘
│ 自动搜索     │    └──────────────────┘              │
│ MCP 工具     │                            ┌────────┴────────┐
└──────────────┘                            │ 搜索 API        │
                                             │（第三阶段：     │
                                             │ 领域加权排序）  │
                                             └─────────────────┘
```

---

## 四、第一阶段 — 立即执行（llm_wiki 核心代码零改动）

### 4.1 schema.md 模板修改

修改 `src-tauri/src/commands/project.rs` 中的项目模板，新增两种页面类型和两个 frontmatter 字段。

**Page Types 表中新增：**

```markdown
| Type | Directory | Purpose |
|------|-----------|---------|
| ... （已有类型不变） |
| bug | wiki/bugs/ | 代码/硬件缺陷：现象 → 根因 → 修复 |
| decision | wiki/decisions/ | 架构/技术选型及理由 |
| howto | wiki/howto/ | 可重复执行的操作流程 |
| agent-error | wiki/agent-errors/ | Claude Code 的错误及纠正方式 |
| pattern | wiki/patterns/ | 重复出现的坑：证据列表 + 预防策略 |
| template | wiki/templates/ | 可复用的项目检查清单，限定适用领域 |
```

**Frontmatter 新增字段：**

```yaml
# 已有字段（不变）
type: ...
title: ...
tags: []
related: []
created: YYYY-MM-DD
updated: YYYY-MM-DD

# 第一阶段新增
project: ""    # 来源项目名，如 "smart-lock-firmware"
domain: ""     # 技术领域，用于跨项目搜索，如 "embedded-arm"
```

**项目初始化时新增目录：**

```rust
let dirs = [
    // ... 已有目录
    "wiki/bugs",          // 已有，确认存在
    "wiki/decisions",     // 已有，确认存在
    "wiki/howto",         // 已有，确认存在
    "wiki/agent-errors",  // 已有，确认存在
    "wiki/patterns",      // 新增
    "wiki/templates",     // 新增
];
```

### 4.2 新脚本：`extract_experiences.py`

位置：`tools/extract_experiences.py`

**用途：** 读取 Claude Code 会话 transcript JSONL，用经验提取 prompt 调用 LLM，输出结构化 `.md` 文件到 `raw/sources/experiences/`。

**输入：**
- Transcript JSONL 文件路径
- 项目名（如 `smart-lock-firmware`）
- 领域名（如 `embedded-arm`）
- 可选：LLM API 配置（endpoint、key、model）

**输出：**
- 一份或多份 `.md` 文件，写入 `raw/sources/experiences/`
- 每份文件包含完整 YAML frontmatter，含 `type`、`project`、`domain`、`tags`

**处理流程：**

```
JSONL transcript
    │
    ├─ [1] 过滤噪音
    │      移除：thinking 块、attachment 事件、系统消息
    │      保留：用户消息、assistant 工具调用、错误输出
    │
    ├─ [2] 按主题分块
    │      按独立任务/错误将 transcript 切分为片段
    │
    ├─ [3] LLM 经验提取（每块一次调用）
    │      Prompt："从这个对话片段中提取项目经验"
    │      Schema：bug | decision | howto | agent-error | pattern
    │      每条：title、symptom、root_cause、solution、prevention、tags
    │
    ├─ [4] 与已有页面去重
    │      检查 wiki/bugs/、wiki/decisions/ 等目录下相似标题/内容
    │      已覆盖 → 跳过，记录 "no new findings"
    │
    └─ [5] 写入 .md 文件
           raw/sources/experiences/YYYY-MM-DD-<slug>.md
           完整 frontmatter 含 type、project、domain、tags
```

**经验提取 Prompt（核心）：**

```
你正在分析一段 Claude Code 对话 transcript，从中提取项目经验。
当前项目："{project_name}"，所属领域："{domain}"。

对于每条你发现的经验，输出一个 FILE 块：

===FILE wiki/{type_dir}/{slug}.md
---
type: {bug|decision|howto|agent-error|pattern}
title: <一句话概述>
tags: [<3-5 个相关标签>]
related: []
project: "{project_name}"
domain: "{domain}"
created: {today}
---

# <标题>

## 现象 / 背景
<发生了什么，用户在做什么>

## 根因
<底层原因>

## 解决方案
<如何解决的>

## 预防措施
<以后如何避免>
===END

类型说明：
- bug：有明确现象和修复方案的代码/硬件缺陷
- decision：有理由的架构/技术选型
- howto：可重复的操作流程（命令、配置步骤）
- agent-error：Claude Code 的错误及纠正方式
- pattern：如果看起来是重复出现的坑，使用 pattern 类型，
          并包含 "Evidence" 章节列出相关事件

如果 transcript 中没有可提取的经验，输出：
NO_EXPERIENCES
```

### 4.3 Hook 集成

#### SessionEnd Hook 扩展（`capture_session.py`）

在现有的 transcript 归档 + Markdown 转换之后，追加：

```python
# 新增：从本次会话提取经验
subprocess.run([
    sys.executable,
    "tools/extract_experiences.py",
    "--transcript", transcript_jsonl_path,
    "--project", os.environ.get("LLM_WIKI_PROJECT", "default"),
    "--domain", os.environ.get("LLM_WIKI_DOMAIN", "general"),
])
```

`LLM_WIKI_PROJECT` 和 `LLM_WIKI_DOMAIN` 通过各项目的 Claude Code 配置或 CLAUDE.md 设置。

#### SessionStart Hook（新建或扩展）

```
会话启动时：
1. 从环境变量/项目配置读取 LLM_WIKI_PROJECT 和 LLM_WIKI_DOMAIN
2. 用 project + domain 关键词调用 MCP llm_wiki_search
3. 获取 top 5 最相关的经验页面
4. 向用户展示摘要："本项目有 3 条相关经验"
5. 将经验标题和 slug 保持在上下文中，供后续参考
```

### 4.4 Stop Hook 错误检测

```
Stop 时（SessionEnd 之前）：
1. 检查最后 N 条 assistant 消息，匹配错误模式
2. 错误关键词："error"、"Error:"、"failed"、"panic"、"exception"、
   "undefined is not"、"Cannot"、"ENOENT"、"ECONNREFUSED" 等
3. 如果检测到错误：
   a. 提取错误信息片段
   b. 用错误关键词调用 MCP llm_wiki_search
   c. 如果找到相关经验 → 注入当前上下文：
      "⚠️ 知识库有相关经验：[[PageName]] — 一句话摘要"
   d. 记录：是否找到经验、哪个页面、模型是否应用了该经验
```

### 4.5 Wiki Index 更新

`wiki/index.md` 新增两个章节：

```markdown
## Patterns

## Templates
```

### 4.6 新类型的页面模板

#### Pattern 页面（`wiki/patterns/ExamplePattern.md`）

```markdown
---
type: pattern
title: <模式名称>
tags: [<领域标签>, <根因标签>]
related: []
project: "<来源项目>"
domain: "<技术领域>"
created: YYYY-MM-DD
---

# <模式名称>

## 概述
<一段话：这个模式描述了什么重复出现的坑>

## 证据
- [[BugPage1]] — <简述>
- [[BugPage2]] — <简述>

## 根因模式
<所有证据背后的共性根因>

## 预防策略
<新项目中避免此坑的具体步骤>

## 检测特征
<要注意什么 — 错误信息、症状、配置特征>
```

#### Template 页面（`wiki/templates/ExampleTemplate.md`）

```markdown
---
type: template
title: <模板名称>
tags: [checklist, <领域>]
related: []
project: "<来源项目>"
domain: "<技术领域>"
created: YYYY-MM-DD
---

# <模板名称>

## 适用范围
<什么样的项目或任务适合使用此模板>

## 前置条件
<使用此模板前必须就绪的条件>

## 步骤 / 检查清单

### 1. <阶段名>
- [ ] <具体项>
- [ ] <具体项>

### 2. <阶段名>
- [ ] <具体项>

## 常见坑点
- [[PatternPage1]] — <简述>
- [[BugPage1]] — <简述>
```

---

## 五、第二阶段 — 经验专用 Ingest 分支

### 5.1 新文件：`src/lib/experience-prompt.ts`

经验提取专用 prompt 构建器，约 150 行。当 Ingest 检测到源文件位于 `sessions/` 或 `experiences/` 目录时调用。

```typescript
// experience-prompt.ts

interface ExperiencePromptConfig {
  project: string
  domain: string
  sourceFileName: string
  existingPages: ExistingPageSummary[]  // 已有经验页面列表，用于去重
}

interface ExistingPageSummary {
  title: string
  type: string
  slug: string
  oneLiner: string
}

export function buildExperienceExtractionPrompt(
  config: ExperiencePromptConfig,
): string {
  // 返回经验提取的完整 system + user prompt
  // 聚焦类型：bug, decision, agent-error, pattern, template
  // 不提取：entity, concept, source, query, comparison, synthesis
  //
  // 包含去重提示：列出已有页面标题/类型，LLM 可跳过已覆盖内容
  //
  // 结构化输出：完整 frontmatter 的 FILE 块
}
```

**与通用 Ingest Prompt 的关键差异：**

| 维度 | 通用 Prompt | 经验 Prompt |
|------|------------|------------|
| 目标类型 | entity, concept, source, query, comparison, synthesis | bug, decision, howto, agent-error, pattern, template |
| 组织结构 | 通用知识组织 | 现象→根因→解决→预防 |
| 项目上下文 | 不含 | 每条经验含 `project` + `domain` |
| 去重方式 | 隐式（依赖后续 merge） | 显式提供已有页面列表 |
| 噪音容忍度 | 高（尽量多捕获） | 低（只提取明确经验） |

### 5.2 `src/lib/ingest.ts` 改动

在 `autoIngestImpl()` 的 LLM 分析步骤入口（约第 800 行）加入分支：

```typescript
// autoIngestImpl() 中的分支伪代码

function selectPromptStrategy(sourcePath: string): 'generic' | 'experience' {
  // sessions/ 或 experiences/ 下的源文件 → 经验 prompt
  if (sourcePath.includes('/sessions/') || sourcePath.includes('/experiences/')) {
    return 'experience'
  }
  return 'generic'
}

// 在 autoIngestImpl() 中，替换当前的单一 prompt 为：
const promptStrategy = selectPromptStrategy(sourceFilePath)
if (promptStrategy === 'experience') {
  const config = await buildExperienceConfig(sourceFilePath, projectPath)
  systemPrompt = buildExperienceExtractionPrompt(config)
  tokenBudget = EXPERIENCE_EXTRACTION_BUDGET  // ~4096，低于默认 8192
} else {
  // 现有通用 prompt 逻辑
}
```

**预估改动量：** 约 200 行，含 `experience-prompt.ts`（新文件）+ `ingest.ts`（分支集成）。

### 5.3 第二阶段启动门槛

第二阶段需要满足以下条件后才执行：

1. 第一阶段已运行 ≥ 2 周
2. extract_experiences.py 已生成至少 10 条经验页面
3. 人工审核页面质量：bug 页面结构是否正确？去重是否生效？
4. 确认通用 Ingest prompt **不能**产出高质量经验页面（如果通用 prompt 已经足够好，经验专用分支就没有必要）

---

## 六、第三阶段 — 跨会话模式挖掘 + 加权搜索（延后执行）

> **说明：** 第三阶段需要足够的数据积累才能生效，现阶段仅记录设计，待条件成熟后实施。

### 6.1 新文件：`src/lib/sweep-patterns.ts`

**触发时机：** Ingest 完成后的钩子（或 UI 中的手动"挖掘模式"按钮）。

**逻辑：**

```
sweepPatterns(projectPath)
    │
    ├─ [1] 收集所有经验页面
    │      扫描 wiki/bugs/、wiki/decisions/、wiki/agent-errors/
    │      提取：tags、根因描述、解决方案关键词
    │
    ├─ [2] 相似度聚类
    │      两两计算相似度：tags 重叠度、根因关键词重叠、domain 匹配
    │      相似度 > 阈值的页面归为一组
    │
    ├─ [3] 对 ≥2 条页面的组生成 pattern
    │      对每个符合条件的分组：
    │        - 从共性根因生成 pattern 标题
    │        - 用 [[wikilinks]] 填充 evidence 列表
    │        - LLM 生成预防策略
    │        - 写入 wiki/patterns/
    │
    ├─ [4] 更新 index
    │      在 wiki/index.md 的 Patterns 章节加入新条目
    │
    └─ [5] 报告
           "从 2 个项目的 8 条 bug 中发现 3 个模式"
```

**执行频率：** 每次 Ingest 后运行，但只有新分组形成时才生成 pattern。幂等操作 — 重复运行不会产生重复页面。

### 6.2 `src-tauri/src/commands/search.rs` 改动

为搜索命令增加可选的加权参数：

```rust
// 搜索选项中新增字段
pub struct SearchOptions {
    // ... 已有字段
    pub prefer_project: Option<String>,  // 提升此项目的搜索结果
    pub prefer_domain: Option<String>,   // 提升此领域的搜索结果
}
```

**加权逻辑（在 RRF 融合之后执行）：**

```
对每条结果：
    base_score = RRF 融合后的分数

    如果 result.project == prefer_project：
        base_score *= 2.0

    如果 result.domain == prefer_domain：
        base_score *= 1.5

    如果两者都匹配：
        base_score *= 3.0   // 2.0 × 1.5

    final_score = base_score
```

结果按 final_score 重新排序。不做过滤 — 跨项目、跨领域的结果仍然可见，只是排在后面。

### 6.3 Settings UI

在 llm_wiki 的设置页面新增"经验系统"区域：

```
经验系统 ──────────────────────────
├── ☐ 会话结束后自动提炼经验
├── ☐ 自动模式挖掘（跨项目发现重复问题）
└── 默认项目：[________________]
   默认领域：[________________]
```

这些设置持久化到 localStorage，通过环境变量或 MCP 参数暴露给 Hook。

---

## 七、CLAUDE.md / KB-Loader 集成

### 7.1 会话启动预加载（KB-LOADER.md 新增步骤）

```markdown
## KB-Loader 预加载

0. （新增）如果配置了 LLM_WIKI_PROJECT，通过 MCP 搜索相关经验
   - 搜索关键词：LLM_WIKI_PROJECT + LLM_WIKI_DOMAIN
   - 取 top 5 经验页面，提取标题和一行摘要
   - 告知用户："该项目有 N 条相关经验"
   - 将经验摘要保持在上下文中，供后续自动触发参考
```

### 7.2 自动触发规则（KB-LOADER.md 新增段落）

```markdown
## 自动触发规则

当 Claude Code 在执行任务时遇到以下情况，**必须**主动通过 MCP 搜索知识库：

1. **编译/运行时错误** — 错误信息包含 "error"、"failed"、"panic"、"cannot" 等
2. **配置文件问题** — 配置不生效、格式错误
3. **环境依赖问题** — 找不到工具、版本不兼容
4. **重复性工作** — 用户问"上次怎么做的"

搜索步骤：
1. 提取错误关键词
2. 调用 llm_wiki_search
3. 如果有匹配结果 → 告知用户找到相关经验，引用 [[PageName]]
4. 如果无匹配 → 继续正常排错流程
5. 问题解决后 → 确认是否产生新经验（如有，标记待 SessionEnd 提取）
```

### 7.3 斜杠命令：`/exp`

```markdown
## /exp — 手动提炼经验

触发词：/exp 或 "提炼经验" 或 "记录这个坑"

动作：
1. 获取当前会话的 transcript（最近的对话）
2. 用户描述要记录的内容（可选：指定类型 bug/decision/pattern）
3. 生成结构化经验页面 → 写入 wiki/ 对应目录
4. 更新 wiki/index.md
5. 追加 wiki/log.md

目的：当 extract_experiences.py 漏掉、或用户觉得某件事特别值得记录时的手动补充。
```

---

## 八、数据流全景

```
                    ┌──────────────────────────────┐
                    │      Claude Code 会话          │
                    │                                │
                    │  SessionStart：预加载经验      │
                    │  会话中：自动检测 + 搜索       │
                    │  /exp：手动标注                │
                    │  SessionEnd：提取脚本          │
                    └──────────┬───────────────────┘
                               │
                               ▼
                    ┌──────────────────────────────┐
                    │   extract_experiences.py      │
                    │   （第一阶段）                 │
                    │                                │
                    │   Transcript → LLM 提取       │
                    │   → raw/sources/experiences/   │
                    └──────────┬───────────────────┘
                               │
                               ▼
                    ┌──────────────────────────────┐
                    │   llm_wiki Source Watch       │
                    │   检测到新 .md 文件            │
                    └──────────┬───────────────────┘
                               │
                               ▼
                    ┌──────────────────────────────┐
                    │   Ingest Pipeline             │
                    │   （第二阶段：经验分支）       │
                    │                                │
                    │   experience-prompt.ts        │
                    │   → bug/decision/pattern 等   │
                    │   → 向量嵌入 → LanceDB         │
                    └──────────┬───────────────────┘
                               │
                               ▼
                    ┌──────────────────────────────┐
                    │   wiki/                       │
                    │   bugs/ decisions/ howto/     │
                    │   agent-errors/ patterns/     │
                    │   templates/                  │
                    └──────────┬───────────────────┘
                               │
                    ┌──────────┴──────────┐
                    ▼                     ▼
             ┌─────────────┐    ┌─────────────────┐
             │ 搜索 API    │    │ sweep-patterns  │
             │（第三阶段： │    │（第三阶段：     │
             │ 领域加权）  │    │ 跨会话挖掘）    │
             └──────┬──────┘    └─────────────────┘
                    │
                    ▼
             ┌─────────────────────────────────┐
             │  Claude Code（下一次会话）       │
             │  经验已预加载 + 自动搜索就绪     │
             └─────────────────────────────────┘
```

---

## 九、明确不做的事项

1. **不改 Obsidian 插件及兼容性** — 经验页面使用相同 .md 格式，天然兼容
2. **不改 MCP Server 协议** — 现有 `llm_wiki_search` + `llm_wiki_read_file` 已足够
3. **不改向量嵌入模型** — LanceDB + 现有嵌入管线保持不变
4. **不改图谱算法** — Louvain 社区发现不变；pattern 页面通过 `related:` 链接证据页面，已有图谱自动纳入
5. **不做实时协作** — 单人使用场景
6. **不做云端同步** — 本地优先，与现有 llm_wiki 一致

---

## 十、风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| LLM 经验提取质量低 | 中 | 高 | 第一阶段是脚本方式（非管线），prompt 可快速迭代；第二阶段有质量审核门槛 |
| 去重遗漏 → 重复经验页 | 中 | 中 | page-merge.ts 的 4 层 merge 保护 + 提取 prompt 中的标题去重 |
| 经验页面污染搜索结果 | 低 | 中 | 经验页面有独立 type；第三阶段加权搜索按项目/领域排序 |
| extract_experiences.py 消耗过多 token | 中 | 低 | token 预算限制 4096；分块防止超长调用；可选 skip 标志 |
| 模式挖掘产生误报 | 高 | 中 | 保守阈值（≥2 条经验才生成 pattern）；人工审核；UI 可关闭 |

---

## 十一、实施顺序

| # | 内容 | 阶段 | 预估工作量 | 依赖 |
|---|------|------|-----------|------|
| 1 | schema.md 模板修改（project.rs） | 1 | 小（30 行） | 无 |
| 2 | extract_experiences.py | 1 | 中（200 行） | LLM API 可访问 |
| 3 | SessionEnd Hook 集成 | 1 | 小（20 行） | #2 |
| 4 | SessionStart 预加载（KB-LOADER.md） | 1 | 小（30 行） | MCP Server 运行中 |
| 5 | Stop Hook 错误检测（KB-LOADER.md） | 1 | 小（40 行） | 无 |
| 6 | /exp 命令（CLAUDE.md） | 1 | 小（30 行） | 无 |
| 7 | 页面模板（wiki/patterns/、wiki/templates/ 等） | 1 | 极小（创建目录） | #1 |
| 8 | experience-prompt.ts | 2 | 中（150 行） | #2 已验证 |
| 9 | ingest.ts 经验分支 | 2 | 中（50 行） | #8 |
| 10 | sweep-patterns.ts | 3 | 大（300 行） | ≥10 条经验页面存在 |
| 11 | search.rs 领域加权 | 3 | 中（80 行） | #1（project/domain 字段） |
| 12 | Settings UI | 3 | 小（50 行 TSX） | #10, #11 |
