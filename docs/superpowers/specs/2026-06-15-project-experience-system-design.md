# Project Experience Accumulation System — Design Spec

**Date:** 2026-06-15
**Status:** Draft
**Context:** Transform llm_wiki into a system that automatically captures, structures, and retrieves project experience (pitfalls, bugs, decisions) across Claude Code sessions.

---

## 1. Problem Statement

### 1.1 Current State

llm_wiki already has a working pipeline:

- **SessionEnd Hook** → archives Claude Code transcripts as JSONL, converts to Markdown
- **Source Watch** → detects new files in `raw/sources/`, triggers auto-ingest
- **Ingest Pipeline** → MinerU/LLM analysis → FILE block parsing → wiki page generation → embedding → LanceDB
- **Search** → BM25 + vector ANN with RRF fusion
- **MCP Server** → 8 tools connecting Claude Code to llm_wiki API

### 1.2 Gap

| Current | Desired |
|---------|---------|
| Transcript is "archived", not analyzed | Transcript is mined for experience |
| No project context — all pages are global | Each experience tagged with `project` + `domain` |
| Global search only | Search weighted by project/domain affinity |
| Passive — user must manually query | Active — auto-detects errors, preloads relevant experience at session start |
| Generic ingest prompt | Experience-specific prompt for bug/decision/pattern extraction |

### 1.3 Success Criteria

1. After a Claude Code session, structured experience pages are automatically generated
2. When Claude Code encounters an error, it proactively searches for related experience
3. At session start, relevant past experience is loaded based on current project context
4. Cross-project patterns are discovered when the same root cause appears ≥2 times

---

## 2. Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Trigger mechanism | All three: manual query + Stop Hook auto-detect + session start preload | Maximum coverage; each serves a different workflow |
| Project granularity | Dual-layer: `project` (source repo) + `domain` (tech area) | Enables both project-specific and cross-project search |
| Experience types | 6 types: bug, decision, howto, agent-error, **pattern**, **template** | pattern = repeated pitfall with evidence; template = reusable checklist |
| Storage | Centralized — all experiences in one llm-wiki project, organized by frontmatter fields | Simpler management, cross-project search is natural |
| Extraction | Auto-extract via script + manual `/exp` slash command | Automation for throughput, manual for precision |
| Auto-detect trigger | Keyword matching on error output + model self-judgment | Fast first pass with semantic fallback |
| Implementation order | Phase 1 (no code changes) → Phase 2 (experience ingest branch) → Phase 3 (pattern mining + weighted search, deferred) | Validate flow before touching core ingest pipeline |

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      Claude Code Session                         │
│                                                                  │
│  SessionStart ──► Preload relevant experience (by project/domain)│
│       │                                                          │
│       ▼                                                          │
│  During session ──► Error detected? ──► Auto-search wiki via MCP │
│       │                                                          │
│       ▼                                                          │
│  SessionEnd ──► Hook: archive transcript + extract experiences   │
│       │                                                          │
│       ▼                                                          │
│  extract_experiences.py ──► LLM extracts structured experience   │
│       │                                                          │
│       ▼                                                          │
│  raw/sources/experiences/ ──► Source Watch detects new files     │
│       │                                                          │
│       ▼                                                          │
│  Ingest Pipeline (Phase 2: experience branch)                    │
│       │                                                          │
│       ▼                                                          │
│  wiki/bugs/ + wiki/decisions/ + wiki/patterns/ + ...             │
│       │                                                          │
│       ▼                                                          │
│  Embedding → LanceDB → Search API (Phase 3: domain-weighted)     │
└─────────────────────────────────────────────────────────────────┘
```

### 3.1 Component Diagram

```
┌──────────────┐    ┌──────────────────┐    ┌─────────────────┐
│ Claude Code  │───►│ extract_experien-│───►│ llm_wiki Ingest │
│ SessionEnd   │    │ ces.py (new)     │    │ Pipeline        │
│ Hook         │    │                  │    │                 │
└──────────────┘    │ LLM call with    │    │ Phase 2:        │
                     │ experience prompt│   │ experience-     │
┌──────────────┐    │                  │    │ prompt.ts       │
│ Claude Code  │    │ Output → .md     │    │                 │
│ SessionStart │    │ files in         │    │ Generate bug/   │
│ Hook         │───►│ raw/sources/     │    │ decision/       │
│              │    │ experiences/     │───►│ pattern pages   │
│ Preload      │    └──────────────────┘    └────────┬────────┘
│ relevant     │                                      │
│ experience   │    ┌──────────────────┐              ▼
└──────────────┘    │ sweep-patterns   │    ┌─────────────────┐
                     │ .ts (Phase 3)   │◄───│ wiki/bugs/      │
┌──────────────┐    │                  │    │ wiki/decisions/ │
│ Claude Code  │    │ Cross-session    │    │ wiki/patterns/  │
│ Error        │───►│ mining: same     │    │ wiki/templates/ │
│ Detection    │    │ root cause ≥2    │    └────────┬────────┘
│ (Stop Hook)  │    │ → auto pattern   │              │
│              │    └──────────────────┘              ▼
│ Auto-search  │                            ┌─────────────────┐
│ MCP tool     │                            │ Search API      │
└──────────────┘                            │ (Phase 3:       │
                                             │ domain-weighted) │
                                             └─────────────────┘
```

---

## 4. Phase 1 — Immediate (No Code Changes to llm_wiki)

### 4.1 schema.md Changes

Add two new page types and two new frontmatter fields to the project template in `src-tauri/src/commands/project.rs`:

**New page types in the Page Types table:**

```markdown
| Type | Directory | Purpose |
|------|-----------|---------|
| ... (existing types) |
| bug | wiki/bugs/ | Code/hardware defects: symptom → root cause → fix |
| decision | wiki/decisions/ | Architecture/technology choices with rationale |
| howto | wiki/howto/ | Repeatable operational procedures |
| agent-error | wiki/agent-errors/ | Claude Code mistakes and corrections |
| pattern | wiki/patterns/ | Recurring pitfall: evidence list + prevention strategy |
| template | wiki/templates/ | Reusable project checklist with domain scoping |
```

**New frontmatter fields:**

```yaml
# Existing fields
type: ...
title: ...
tags: []
related: []
created: YYYY-MM-DD
updated: YYYY-MM-DD

# New fields (Phase 1)
project: ""    # Source repo name, e.g. "smart-lock-firmware"
domain: ""     # Tech area for cross-project search, e.g. "embedded-arm"
```

**New directories created at project init:**

```rust
let dirs = [
    // ... existing dirs
    "wiki/bugs",          // ← existing, add if not present
    "wiki/decisions",     // ← existing, add if not present
    "wiki/howto",         // ← existing, add if not present
    "wiki/agent-errors",  // ← existing, add if not present
    "wiki/patterns",      // NEW
    "wiki/templates",     // NEW
];
```

### 4.2 New Script: `extract_experiences.py`

Location: `tools/extract_experiences.py` (in llm-wiki-agent, copied to llm_wiki's tools/ for distribution)

**Purpose:** Read a Claude Code transcript JSONL, call LLM with experience extraction prompt, output structured `.md` files to `raw/sources/experiences/`.

**Input:**
- Transcript JSONL file path
- Project name (e.g., `smart-lock-firmware`)
- Domain (e.g., `embedded-arm`)
- Optional: LLM API config (endpoint, key, model)

**Output:**
- One or more `.md` files written to `raw/sources/experiences/`
- Each file has full YAML frontmatter with `type`, `project`, `domain`, `tags`

**Pipeline:**

```
JSONL transcript
    │
    ├─ [1] Filter noise
    │      Remove: thinking blocks, attachment events, system messages
    │      Keep: user messages, assistant tool calls, error outputs
    │
    ├─ [2] Chunk by topic
    │      Split transcript into segments around distinct tasks/errors
    │
    ├─ [3] LLM extraction call (per chunk)
    │      Prompt: "Extract experiences from this conversation segment"
    │      Schema: bug | decision | howto | agent-error | pattern | template
    │      For each: title, symptom, root_cause, solution, prevention, tags
    │
    ├─ [4] Dedup against existing pages
    │      Check wiki/bugs/, wiki/decisions/ etc. for similar title/content
    │      Skip if already covered → log "no new findings"
    │
    └─ [5] Write .md files
           raw/sources/experiences/YYYY-MM-DD-<slug>.md
           Full frontmatter with type, project, domain, tags
```

**Experience extraction prompt (core):**

```
You are analyzing a Claude Code conversation transcript to extract
project experience. The project is "{project_name}" in the
"{domain}" domain.

For each distinct experience you find, output a FILE block:

===FILE wiki/{type_dir}/{slug}.md
---
type: {bug|decision|howto|agent-error|pattern}
title: <concise one-line summary>
tags: [<3-5 relevant tags>]
related: []
project: "{project_name}"
domain: "{domain}"
created: {today}
---

# <title>

## Symptom / Context
<what happened, what was the user doing>

## Root Cause
<the underlying issue>

## Solution
<how it was resolved>

## Prevention
<how to avoid this in the future>
===END

Types:
- bug: code/hardware defect with clear symptom and fix
- decision: architecture/technology choice with rationale
- howto: repeatable procedure (commands, config steps)
- agent-error: Claude Code mistake and correction
- pattern: if this looks like a recurring pitfall, use type: pattern
          and include an "Evidence" section listing related incidents

If the transcript contains no extractable experience, output:
NO_EXPERIENCES
```

### 4.3 Hook Integration

#### SessionEnd Hook updates (`capture_session.py`)

After existing transcript archive + markdown conversion, add:

```python
# NEW: Extract experiences from this session
subprocess.run([
    sys.executable,
    "tools/extract_experiences.py",
    "--transcript", transcript_jsonl_path,
    "--project", os.environ.get("LLM_WIKI_PROJECT", "default"),
    "--domain", os.environ.get("LLM_WIKI_DOMAIN", "general"),
])
```

The `LLM_WIKI_PROJECT` and `LLM_WIKI_DOMAIN` env vars are configured per-project in Claude Code settings or CLAUDE.md.

#### SessionStart Hook (new or extended)

```
On session start:
1. Read LLM_WIKI_PROJECT and LLM_WIKI_DOMAIN from env/project config
2. Call MCP llm_wiki_search with project + domain keywords
3. Fetch top 5 most relevant experience pages
4. Present summary to user: "Loaded 3 relevant experiences from this project"
5. Keep experience titles + slugs in context for later reference
```

### 4.4 Stop Hook Error Detection

```
On Stop (before SessionEnd):
1. Check last N assistant messages for error patterns
2. Error keywords: "error", "Error:", "failed", "panic", "exception",
   "undefined is not", "Cannot", "ENOENT", "ECONNREFUSED", etc.
3. If error detected:
   a. Extract error message snippet
   b. Call MCP llm_wiki_search with error keywords
   c. If relevant experience found → inject into current context:
      "⚠️ Wiki has relevant experience: [[PageName]] — {one-line summary}"
   d. Log: whether experience was found, which page, whether model applied it
```

### 4.5 Wiki Index Updates

`wiki/index.md` gets two new sections:

```markdown
## Patterns

## Templates
```

### 4.6 Page Templates for New Types

#### Pattern (`wiki/patterns/ExamplePattern.md`)

```markdown
---
type: pattern
title: <pattern name>
tags: [<domain-tags>, <root-cause-tag>]
related: []
project: "<source project>"
domain: "<tech domain>"
created: YYYY-MM-DD
---

# <pattern name>

## Summary
<One paragraph: what recurring pitfall this pattern describes>

## Evidence
- [[BugPage1]] — <brief description>
- [[BugPage2]] — <brief description>

## Root Cause Pattern
<The common underlying cause across all evidence>

## Prevention Strategy
<Concrete steps to avoid this pitfall in new projects>

## Detection Heuristics
<What to look for — error messages, symptoms, configurations>
```

#### Template (`wiki/templates/ExampleTemplate.md`)

```markdown
---
type: template
title: <template name>
tags: [checklist, <domain>]
related: []
project: "<source project>"
domain: "<tech domain>"
created: YYYY-MM-DD
---

# <template name>

## Applies To
<What kind of project or task this template is for>

## Prerequisites
<What must be in place before using this template>

## Steps / Checklist

### 1. <Phase name>
- [ ] <concrete item>
- [ ] <concrete item>

### 2. <Phase name>
- [ ] <concrete item>

## Common Pitfalls
- [[PatternPage1]] — <brief description>
- [[BugPage1]] — <brief description>
```

---

## 5. Phase 2 — Experience-Specific Ingest Branch

### 5.1 New File: `src/lib/experience-prompt.ts`

A dedicated prompt builder for experience extraction, ~150 lines. Called when ingest detects the source is in a sessions/ or experiences/ directory.

```typescript
// experience-prompt.ts

interface ExperiencePromptConfig {
  project: string
  domain: string
  sourceFileName: string
  existingPages: ExistingPageSummary[]
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
  // Returns the full system + user prompt for experience extraction.
  // Focused on: bug, decision, agent-error, pattern, template
  // Does NOT extract: entity, concept, source, query, comparison, synthesis
  //
  // Includes dedup hints: list of existing pages by title/type so the
  // LLM can skip what's already covered.
  //
  // Structured output: FILE blocks with complete frontmatter.
}
```

**Key differences from generic ingest prompt:**

| Aspect | Generic Prompt | Experience Prompt |
|--------|---------------|-------------------|
| Target types | entity, concept, source, query, comparison, synthesis | bug, decision, howto, agent-error, pattern, template |
| Structure | General knowledge organization | Symptom→RootCause→Solution→Prevention |
| Project context | Not included | `project` + `domain` in every page |
| Dedup | Implicit | Explicit list of existing pages to avoid |
| Noise tolerance | High (captures everything) | Low (only extract clear experience) |

### 5.2 Changes to `src/lib/ingest.ts`

Add a branch at the entry of the LLM analysis step (~line 800 in autoIngestImpl):

```typescript
// Pseudo-code for the branch point in autoIngestImpl()

function selectPromptStrategy(sourcePath: string): 'generic' | 'experience' {
  // Source files under sessions/ or experiences/ → experience prompt
  if (sourcePath.includes('/sessions/') || sourcePath.includes('/experiences/')) {
    return 'experience'
  }
  return 'generic'
}

// In autoIngestImpl(), replace the current single prompt with:
const promptStrategy = selectPromptStrategy(sourceFilePath)
if (promptStrategy === 'experience') {
  const config = await buildExperienceConfig(sourceFilePath, projectPath)
  systemPrompt = buildExperienceExtractionPrompt(config)
  // Use lower token budget for focused extraction
  tokenBudget = EXPERIENCE_EXTRACTION_BUDGET // ~4096 vs 8192 default
} else {
  // existing generic prompt
}
```

**Estimated change scope:** ~200 lines across `experience-prompt.ts` (new) + `ingest.ts` (branch + integration).

### 5.3 Validation Gate for Phase 2

Phase 2 is gated on:

1. Phase 1 has been running for ≥2 weeks
2. At least 10 experience pages generated via extract_experiences.py
3. Review of generated page quality: are bug pages properly structured? Is dedup working?
4. Confirmation that the generic ingest prompt is NOT producing good experience pages (which would make the experience-specific branch unnecessary)

---

## 6. Phase 3 — Cross-Session Pattern Mining + Weighted Search (Deferred)

### 6.1 New File: `src/lib/sweep-patterns.ts`

**Trigger:** Post-ingest hook (or manual "Mine Patterns" button in UI).

**Logic:**

```
sweepPatterns(projectPath)
    │
    ├─ [1] Gather all experience pages
    │      Scan wiki/bugs/, wiki/decisions/, wiki/agent-errors/
    │      Extract: tags, root_cause, solution_keywords
    │
    ├─ [2] Cluster by similarity
    │      Compute pairwise similarity on: tags overlap, root cause
    │      keyword overlap, domain match
    │      Group pages with similarity > threshold into clusters
    │
    ├─ [3] Generate pattern for clusters with ≥2 pages
    │      For each qualifying cluster:
    │        - Generate pattern title from common root cause
    │        - Populate evidence list with [[links]] to cluster members
    │        - LLM-generate prevention strategy
    │        - Write to wiki/patterns/
    │
    ├─ [4] Update index
    │      Add pattern to wiki/index.md Patterns section
    │
    └─ [5] Report
           "Found 3 patterns from 8 bug pages across 2 projects"
```

**Frequency:** Run per ingest, but pattern generation only triggers when new clusters form. Idempotent — re-running does not duplicate patterns.

### 6.2 Changes to `src-tauri/src/commands/search.rs`

Add optional weighting parameters to the search command:

```rust
// New fields in search options
pub struct SearchOptions {
    // ... existing fields
    pub prefer_project: Option<String>,  // boost results from this project
    pub prefer_domain: Option<String>,   // boost results from this domain
}
```

**Weighting logic (post-RRF fusion):**

```
For each result:
    base_score = RRF_fused_score

    if result.project == prefer_project:
        base_score *= 2.0

    if result.domain == prefer_domain:
        base_score *= 1.5

    if both match:
        base_score *= 3.0   // 2.0 * 1.5

    final_score = base_score
```

Results are re-sorted by final_score. No results are filtered out — cross-project/domain results are still visible, just lower-ranked.

### 6.3 Settings UI

Add an "Experience System" section to the Settings panel in the React frontend:

```
Experience System
├── ☐ Auto-extract experiences after each session
├── ☐ Auto-mine patterns (cross-project pitfall detection)
└── Default project: [________________]
   Default domain:  [________________]
```

These settings are persisted to localStorage and exposed to hooks via env vars or MCP parameters.

---

## 7. CLAUDE.md / KB-Loader Integration

### 7.1 SessionStart Preload (in KB-LOADER.md)

Add a step to the KB-Loader startup sequence:

```markdown
## KB-Loader 预加载

0. (NEW) 如果配置了 LLM_WIKI_PROJECT，通过 MCP 搜索相关经验
   - 搜索关键词: LLM_WIKI_PROJECT + LLM_WIKI_DOMAIN
   - 取 top 5 经验页面，提取标题和一行摘要
   - 告知用户："该项目有 N 条相关经验"
   - 将经验摘要保持在上下文（供后续自动触发参考）
```

### 7.2 Auto-Detect Trigger (in KB-LOADER.md)

Add guidance for Claude Code to self-trigger experience search:

```markdown
## 自动触发规则

当 Claude Code 在执行任务时遇到以下情况，**必须**主动通过 MCP 搜索知识库：

1. **编译/运行时错误** — 错误信息包含 "error", "failed", "panic", "cannot" 等
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

### 7.3 Slash Command: `/exp`

A manual slash command for users to explicitly extract experience from the current session:

```markdown
## /exp — 手动提炼经验

触发词: /exp 或 "提炼经验" 或 "记录这个坑"

动作:
1. 获取当前会话的 transcript（最近的对话）
2. 用户描述要记录的内容（可选：指定类型 bug/decision/pattern）
3. 生成结构化经验页面 → 写入 wiki/ 对应目录
4. 更新 wiki/index.md
5. 追加 wiki/log.md

目的：当 extract_experiences.py 漏掉、或用户觉得某件事特别值得记录时的手动补充。
```

---

## 8. Data Flow Summary

```
                    ┌──────────────────────────────┐
                    │     Claude Code Session        │
                    │                                │
                    │  SessionStart: preload exp     │
                    │  During: auto-detect + search  │
                    │  /exp: manual mark             │
                    │  SessionEnd: extract script    │
                    └──────────┬───────────────────┘
                               │
                               ▼
                    ┌──────────────────────────────┐
                    │   extract_experiences.py      │
                    │   (Phase 1)                   │
                    │                                │
                    │   Transcript → LLM extraction  │
                    │   → raw/sources/experiences/   │
                    └──────────┬───────────────────┘
                               │
                               ▼
                    ┌──────────────────────────────┐
                    │   llm_wiki Source Watch       │
                    │   Detects new .md files       │
                    └──────────┬───────────────────┘
                               │
                               ▼
                    ┌──────────────────────────────┐
                    │   Ingest Pipeline             │
                    │   (Phase 2: experience branch)│
                    │                                │
                    │   experience-prompt.ts        │
                    │   → bug/decision/pattern/etc  │
                    │   → embedding → LanceDB        │
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
             │ Search API  │    │ sweep-patterns  │
             │ (Phase 3:   │    │ (Phase 3:       │
             │  weighted)  │    │  cross-session) │
             └──────┬──────┘    └─────────────────┘
                    │
                    ▼
             ┌─────────────────────────────────┐
             │  Claude Code (next session)      │
             │  Preloaded + auto-search ready   │
             └─────────────────────────────────┘
```

---

## 9. Non-Goals (Explicitly Out of Scope)

1. **No changes to Obsidian plugin or Obsidian compatibility** — experience pages use the same .md format
2. **No MCP server protocol changes** — existing `llm_wiki_search` + `llm_wiki_read_file` are sufficient
3. **No embedding model changes** — LanceDB + existing embedding pipeline unchanged
4. **No graph algorithm changes** — existing Louvain community detection unchanged; pattern pages will naturally link to their evidence pages via `related:` frontmatter, which the graph already handles
5. **No real-time collaboration features** — single-user system
6. **No cloud sync** — local-first, same as current llm_wiki

---

## 10. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| LLM extraction produces low-quality pages | Medium | High | Phase 1 is script-based (not pipeline), easy to iterate on prompt; Phase 2 gates on quality review |
| Dedup misses → duplicate experience pages | Medium | Medium | Existing page-merge.ts 4-layer merge protects against body duplication; title-based dedup in extraction prompt |
| Experience pages pollute search results | Low | Medium | Experience pages have distinct types; Phase 3 weighting ensures relevance |
| extract_experiences.py costs too many tokens | Medium | Low | Token budget capped at 4096; chunking prevents oversized calls; optional skip flag |
| Pattern mining produces false positives | High | Medium | Conservative threshold (≥2 pages); human review before auto-creating pattern; UI toggle to disable |

---

## 11. Implementation Order

| # | What | Phase | Estimated Effort | Dependencies |
|---|------|-------|-----------------|--------------|
| 1 | schema.md changes (project.rs) | 1 | Small (30 lines) | None |
| 2 | extract_experiences.py | 1 | Medium (200 lines) | LLM API access |
| 3 | SessionEnd hook integration | 1 | Small (20 lines) | #2 |
| 4 | SessionStart preload (KB-LOADER.md) | 1 | Small (30 lines) | MCP server running |
| 5 | Stop Hook error detection (KB-LOADER.md) | 1 | Small (40 lines) | None |
| 6 | /exp slash command (CLAUDE.md) | 1 | Small (30 lines) | None |
| 7 | Page templates (wiki/patterns/, wiki/templates/) | 1 | Trivial (create dirs) | #1 |
| 8 | experience-prompt.ts | 2 | Medium (150 lines) | #2 validated |
| 9 | ingest.ts experience branch | 2 | Medium (50 lines) | #8 |
| 10 | sweep-patterns.ts | 3 | Large (300 lines) | ≥10 experience pages exist |
| 11 | search.rs domain weighting | 3 | Medium (80 lines) | #1 (project/domain fields) |
| 12 | Settings UI | 3 | Small (50 lines TSX) | #10, #11 |
