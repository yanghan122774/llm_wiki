# Phase 2: 经验提取 Ingest 管线 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Ingest 管线检测到 `experiences/` 或 `sessions/` 源文件时，引导 LLM 产出 6 种经验类型页面

**Architecture:** 三层各司其职 — 检测(`isExperienceSource`) → 引导(prompt "What to generate" 切换) → 约束(schema + `validateWikiPageRouting` 兜底)。不在通用 prompt 之外另起炉灶，而是在通用 prompt 内部根据 `isExperience` 参数切换生成目标。

**Tech Stack:** TypeScript 5.7, Python 3, Tauri v2

---

## File Structure

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/lib/ingest.ts` | 修改 | 核心：加 `isExperience` 参数到两个 prompt 函数 + utility 函数 + `autoIngestImpl` 分支 |
| `tools/extract_experiences.py` | 重写 | Transcript JSONL → Markdown（纯文本，不调 LLM） |
| `src/lib/wiki-schema.ts` | 修改 | `validateWikiPageRouting` 拒绝 schema 中不存在的 type |
| `src/lib/templates.ts` | 修改 | 新增 experienceTemplate（6 种经验类型） |

---

### Task 1: 重写 `tools/extract_experiences.py` — 纯文本处理

**目标:** 去掉所有 LLM 调用，变为纯文本转换：transcript JSONL → 过滤噪音 → 提取文本 → 写 Markdown 到 `raw/sources/experiences/`，带 project/domain frontmatter。让后续 Ingest 管线自动处理。

**Files:**
- Modify: `tools/extract_experiences.py`

- [ ] **Step 1: 替换整个文件内容**

将文件完全替换为以下纯文本处理版本（保留原有的过滤/分块逻辑，去掉 LLM 调用，改写输出）：

```python
#!/usr/bin/env python3
"""
extract_experiences.py — 从 Claude Code transcript 提取会话文本为 Markdown

读取 Claude Code 会话 transcript JSONL，过滤噪音，合并为可读文本，
写入 raw/sources/experiences/ 目录（带 project/domain frontmatter）。
输出文件会被 llm_wiki Ingest 管线自动检测并处理。

用法:
    python tools/extract_experiences.py \
        --transcript /path/to/transcript.jsonl \
        --project smart-lock-firmware \
        --domain embedded-arm \
        --output-dir /path/to/wiki/raw/sources/experiences
"""

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# 1. 过滤噪音
# ---------------------------------------------------------------------------

NOISE_ROLES = {"system", "attachment"}
NOISE_TYPES = {"thinking", "attachment"}


def is_noise_message(msg: dict) -> bool:
    """过滤 thinking 块、attachment 事件、系统消息。"""
    role = msg.get("role", "")
    msg_type = msg.get("type", "")

    if role in NOISE_ROLES:
        return True
    if msg_type in NOISE_TYPES:
        return True
    if msg.get("content") is None or msg.get("content", "") == "":
        return True
    if isinstance(msg.get("content"), list):
        texts = [b.get("text", "") for b in msg["content"] if b.get("type") == "text"]
        return all(t.strip() == "" for t in texts)
    return False


def load_transcript(path: str) -> list[dict]:
    """读取 JSONL transcript，返回过滤后的消息列表。"""
    messages = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not is_noise_message(msg):
                messages.append(msg)
    return messages


# ---------------------------------------------------------------------------
# 2. 文本提取
# ---------------------------------------------------------------------------

def extract_text(msg: dict) -> str:
    """从消息中提取可读文本。"""
    content = msg.get("content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict):
                t = block.get("text", "")
                if t:
                    parts.append(t)
                if block.get("type") == "tool_use":
                    name = block.get("name", "")
                    inp = block.get("input", {})
                    parts.append(f"[tool_use: {name}] {json.dumps(inp, ensure_ascii=False)}")
                if block.get("type") == "tool_result":
                    parts.append(f"[tool_result] {block.get('content','')}")
        return "\n".join(parts)
    return str(content)


def format_msg(msg: dict, idx: int) -> str:
    """格式化单条消息为可读文本。"""
    role = msg.get("role", "unknown")
    text = extract_text(msg)
    # 不截断，保留完整内容让 Ingest 管线处理
    return f"## [{idx}] {role}\n\n{text}\n"


def build_markdown(messages: list[dict], project: str, domain: str) -> str:
    """将消息列表构建为完整 Markdown 文件。"""
    today = datetime.now().strftime("%Y-%m-%d")
    
    parts = [
        "---",
        f"project: {project}",
        f"domain: {domain}",
        f"created: {today}",
        "---",
        "",
        f"# Session Transcript — {today}",
        "",
        f"**Project:** {project}  ",
        f"**Domain:** {domain}  ",
        f"**Messages:** {len(messages)}",
        "",
        "---",
        "",
    ]
    
    for i, msg in enumerate(messages):
        parts.append(format_msg(msg, i))
    
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# 3. 写入
# ---------------------------------------------------------------------------

def write_output(output_dir: str, content: str, project: str, transcript_path: str) -> str:
    """将 Markdown 内容写入文件。返回写入路径。"""
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)
    
    today = datetime.now().strftime("%Y-%m-%d")
    # 用 transcript 文件名 + 内容哈希生成唯一标识
    base = Path(transcript_path).stem
    content_hash = hashlib.sha256(content.encode()).hexdigest()[:8]
    safe_project = re.sub(r"[^\w\-]+", "-", project.lower()).strip("-")[:40]
    filename = f"{today}-{safe_project}-{base}--{content_hash}.md"
    filepath = out_path / filename
    
    filepath.write_text(content, encoding="utf-8")
    return str(filepath)


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="从 Claude Code transcript 提取会话文本为 Markdown"
    )
    parser.add_argument("--transcript", required=True, help="Transcript JSONL 文件路径")
    parser.add_argument("--project", default="default", help="来源项目名")
    parser.add_argument("--domain", default="general", help="技术领域")
    parser.add_argument(
        "--output-dir",
        default=None,
        help="输出目录（默认: transcript 同级目录下的 raw/sources/experiences/）",
    )
    parser.add_argument("--dry-run", action="store_true", help="只打印预览，不写入文件")

    args = parser.parse_args()

    if args.output_dir:
        output_dir = args.output_dir
    else:
        transcript_dir = Path(args.transcript).parent
        output_dir = transcript_dir / "raw" / "sources" / "experiences"

    print(f"[1/3] 读取 transcript: {args.transcript}")
    messages = load_transcript(args.transcript)
    print(f"      有效消息: {len(messages)} 条")

    if not messages:
        print("      没有有效消息，退出。")
        return

    print(f"[2/3] 构建 Markdown...")
    content = build_markdown(messages, args.project, args.domain)
    print(f"      生成 {len(content)} 字符")

    print(f"[3/3] 写入文件...")
    if args.dry_run:
        print(f"    [dry-run] 预览前 500 字符:")
        print(content[:500])
        print(f"\n[dry-run] 共 {len(content)} 字符（未写入）")
    else:
        path = write_output(str(output_dir), content, args.project, args.transcript)
        print(f"    写入: {path}")
        print(f"\n完成！Ingest 管线将自动检测并处理此文件。")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 验证语法正确**

```bash
cd d:\work\llm_wiki && python -c "import py_compile; py_compile.compile('tools/extract_experiences.py', doraise=True); print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add tools/extract_experiences.py
git commit -m "feat: rewrite extract_experiences.py to pure text processing (no LLM calls)"
```

---

### Task 2: `src/lib/ingest.ts` — 添加经验检测工具函数

**目标:** 在 `ingest.ts` 顶部添加 `EXPERIENCE_TYPES` 常量、`isExperienceSource()`、`extractExperienceMeta()` 三个工具。

**Files:**
- Modify: `src/lib/ingest.ts`

- [ ] **Step 1: 在 imports 区域后面、`LONG_SOURCE_MIN_BUDGET` 前面插入常量**

在 `import { computeContextBudget } from "@/lib/context-budget"` 后面、`const LONG_SOURCE_MIN_BUDGET` 前面，插入：

```typescript
/** 经验类型列表 —— 用于 Ingest 管线检测到经验源时切换 prompt */
export const EXPERIENCE_TYPES = [
  "bug",
  "decision",
  "howto",
  "agent-error",
  "pattern",
  "template",
] as const

/**
 * 判断源文件是否应走经验提取路径。
 * 匹配路径中包含 /experiences/ 或 /sessions/ 的文件。
 */
export function isExperienceSource(sourcePath: string): boolean {
  const normalized = sourcePath.replace(/\\/g, "/").toLowerCase()
  return (
    normalized.includes("/experiences/") ||
    normalized.includes("/sessions/") ||
    normalized.startsWith("experiences/") ||
    normalized.startsWith("sessions/")
  )
}

/**
 * 从经验源 Markdown 的 frontmatter 中提取 project 和 domain。
 * extract_experiences.py 会在 frontmatter 中写入这两个字段。
 */
export function extractExperienceMeta(sourceContent: string): {
  project: string
  domain: string
} {
  const projectMatch = sourceContent.match(/^project:\s*(.+)$/m)
  const domainMatch = sourceContent.match(/^domain:\s*(.+)$/m)
  return {
    project: projectMatch?.[1]?.trim() || "unknown",
    domain: domainMatch?.[1]?.trim() || "general",
  }
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
cd d:\work\llm_wiki && npx tsc --noEmit 2>&1 | head -20
```

Expected: No new errors (only pre-existing ones if any).

- [ ] **Step 3: Commit**

```bash
git add src/lib/ingest.ts
git commit -m "feat: add isExperienceSource, extractExperienceMeta, EXPERIENCE_TYPES to ingest.ts"
```

---

### Task 3: `src/lib/ingest.ts` — 修改 `buildAnalysisPrompt()` 

**目标:** 添加 `isExperience` 和 `experienceMeta` 参数，切换经验分析维度。

**Files:**
- Modify: `src/lib/ingest.ts` — `buildAnalysisPrompt()` 函数签名和内部 "Your analysis should cover" 段落

- [ ] **Step 1: 修改函数签名**

将:
```typescript
export function buildAnalysisPrompt(purpose: string, index: string, sourceContent: string = ""): string {
```
改为:
```typescript
export function buildAnalysisPrompt(
  purpose: string,
  index: string,
  sourceContent: string = "",
  isExperience: boolean = false,
  experienceMeta?: { project: string; domain: string },
): string {
```

- [ ] **Step 2: 在 "Your analysis should cover:" 之前插入经验分析维度**

在函数体内部，`languageRule(sourceContent),` 行之后，这样修改：

将现有的整段 "Your analysis should cover:" 逻辑改为条件分支。找到：

```typescript
    languageRule(sourceContent),
    "",
    "Your analysis should cover:",
    "",
    "## Key Entities",
    ...
    "Be thorough but concise. Focus on what's genuinely important.",
```

替换为:

```typescript
    languageRule(sourceContent),
    "",
    isExperience
      ? [
          `Project: ${experienceMeta?.project || "unknown"}  |  Domain: ${experienceMeta?.domain || "general"}`,
          "",
          "Your analysis should cover:",
          "",
          "## 1. Bugs & Defects",
          "- What went wrong? Describe symptoms and error messages.",
          "- What was the root cause?",
          "- How was it fixed?",
          "- Could this happen in other projects?",
          "",
          "## 2. Architecture & Technology Decisions",
          "- What choices were made? What alternatives were considered?",
          "- What was the rationale?",
          "- What were the consequences (good or bad)?",
          "",
          "## 3. How-To / Repeatable Procedures",
          "- Any setup steps, configuration sequences, or workflows that were performed?",
          "- Are they general enough to be reused in other projects?",
          "- Key commands, file paths, and configuration values.",
          "",
          "## 4. Agent Errors (Claude Code mistakes)",
          "- Did Claude make mistakes? (wrong code, wrong config, wrong assumption)",
          "- How was the mistake corrected?",
          "- What triggered the mistake? (specific prompt patterns, ambiguous requests)",
          "",
          "## 5. Potential Patterns",
          "- Do any of the bugs or agent-errors look like they could recur?",
          "- Is there a common root cause across multiple issues?",
          "- Is there evidence (multiple occurrences) to support creating a pattern page?",
          "",
          "## 6. Cross-references to Existing Wiki",
          "- Do any of these findings relate to existing experience pages?",
          "- Check the index for similar bugs, decisions, or patterns.",
          "",
          "Focus on actionable, reusable knowledge. Skip trivial chat and meta-discussion about the tool itself.",
        ].join("\n")
      : [
          "Your analysis should cover:",
          "",
          "## Key Entities",
          "List people, organizations, products, datasets, tools mentioned. For each:",
          "- Name and type",
          "- Role in the source (central vs. peripheral)",
          "- Whether it likely already exists in the wiki (check the index)",
          "",
          "## Key Concepts",
          "List theories, methods, techniques, phenomena. For each:",
          "- Name and brief definition",
          "- Why it matters in this source",
          "- Whether it likely already exists in the wiki",
          "",
          "## Main Arguments & Findings",
          "- What are the core claims or results?",
          "- What evidence supports them?",
          "- How strong is the evidence?",
          "",
          "## Connections to Existing Wiki",
          "- What existing pages does this source relate to?",
          "- Does it strengthen, challenge, or extend existing knowledge?",
          "",
          "## Contradictions & Tensions",
          "- Does anything in this source conflict with existing wiki content?",
          "- Are there internal tensions or caveats?",
          "",
          "## Recommendations",
          "- What wiki pages should be created or updated?",
          "- What should be emphasized vs. de-emphasized?",
          "- Any open questions worth flagging for the user?",
          "",
          "Be thorough but concise. Focus on what's genuinely important.",
        ].join("\n"),
    "",
    "If a folder context is provided, use it as a hint for categorization — the folder structure often reflects the user's organizational intent (e.g., 'papers/energy' suggests the file is an energy-related paper).",
    "",
```

- [ ] **Step 3: 验证 TypeScript 编译**

```bash
cd d:\work\llm_wiki && npx tsc --noEmit 2>&1 | head -20
```

Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ingest.ts
git commit -m "feat: add isExperience parameter to buildAnalysisPrompt"
```

---

### Task 4: `src/lib/ingest.ts` — 修改 `buildGenerationPrompt()`

**目标:** 添加 `isExperience` 和 `experienceMeta` 参数，切换 "What to generate" 段落和 frontmatter type 列表。

**Files:**
- Modify: `src/lib/ingest.ts` — `buildGenerationPrompt()` 函数签名和内部段落

- [ ] **Step 1: 修改函数签名**

将:
```typescript
export function buildGenerationPrompt(
  schema: string,
  purpose: string,
  index: string,
  sourceFileName: string,
  overview?: string,
  sourceContent: string = "",
  sourceSummaryPath?: string,
): string {
```
改为:
```typescript
export function buildGenerationPrompt(
  schema: string,
  purpose: string,
  index: string,
  sourceFileName: string,
  overview?: string,
  sourceContent: string = "",
  sourceSummaryPath?: string,
  isExperience: boolean = false,
  experienceMeta?: { project: string; domain: string },
): string {
```

- [ ] **Step 2: 添加 debug 日志**

在 `const today = currentWikiDate()` 之后添加:

```typescript
  console.error(`[GEN-v8] buildGenerationPrompt called — isExperience=${isExperience} sourceFileName="${sourceFileName}"`)
```

- [ ] **Step 3: 替换 "What to generate" 段落**

将:
```typescript
    "## What to generate",
    "",
    `1. A source summary page at **${summaryPath}** (MUST use this exact path)`,
    "2. Entity or schema-defined typed pages for key named things identified in the analysis. Prefer schema-defined directories when present; otherwise use wiki/entities/.",
    "3. Concept or schema-defined typed pages for key ideas, methods, techniques, and abstractions. Prefer schema-defined directories when present; otherwise use wiki/concepts/.",
    "4. An updated wiki/index.md — add new entries to existing categories, preserve all existing entries",
    "5. A log entry for wiki/log.md (just the new entry to append, format: ## [YYYY-MM-DD] ingest | Title)",
    "6. An updated wiki/overview.md — a high-level summary of what the entire wiki covers, updated to reflect the newly ingested source. This should be a comprehensive 2-5 paragraph overview of ALL topics in the wiki, not just the new source.",
```

替换为根据 `isExperience` 条件选择的内容:

```typescript
    isExperience
      ? [
          "## What to generate",
          "",
          "This is a PROJECT EXPERIENCE extraction task. The source is a development",
          "session transcript. Generate ONE FILE block PER experience found.",
          "Do NOT create a source summary page. The transcript itself IS the source.",
          "",
          "1. **bug** pages → wiki/bugs/<slug>.md",
          "   Structure: ## 现象 → ## 根因 → ## 解决方案 → ## 预防措施",
          "2. **decision** pages → wiki/decisions/<slug>.md",
          "   Structure: ## 背景 → ## 考虑的方案 → ## 决策 → ## 后果",
          "3. **howto** pages → wiki/howto/<slug>.md",
          "   Structure: ## 目的 → ## 前置条件 → ## 步骤 → ## 验证",
          "4. **agent-error** pages → wiki/agent-errors/<slug>.md",
          "   Structure: ## 错误行为 → ## 纠正方式 → ## 触发特征 → ## 预防",
          "5. **pattern** pages → wiki/patterns/<slug>.md",
          "   Use ONLY when ≥2 related bugs share a root cause. Include ## 证据 section.",
          "6. **template** pages → wiki/templates/<slug>.md",
          "   Structure: ## 适用范围 → ## 检查清单 → ## 常见坑点",
          "",
          "Do NOT create wiki/sources/ pages — this source type doesn't need them.",
          "If the analysis has NO extractable experiences, output only a single",
          "FILE block containing the word NO_EXPERIENCES as its content.",
        ].join("\n")
      : [
          "## What to generate",
          "",
          `1. A source summary page at **${summaryPath}** (MUST use this exact path)`,
          "2. Entity or schema-defined typed pages for key named things identified in the analysis. Prefer schema-defined directories when present; otherwise use wiki/entities/.",
          "3. Concept or schema-defined typed pages for key ideas, methods, techniques, and abstractions. Prefer schema-defined directories when present; otherwise use wiki/concepts/.",
          "4. An updated wiki/index.md — add new entries to existing categories, preserve all existing entries",
          "5. A log entry for wiki/log.md (just the new entry to append, format: ## [YYYY-MM-DD] ingest | Title)",
          "6. An updated wiki/overview.md — a high-level summary of what the entire wiki covers, updated to reflect the newly ingested source. This should be a comprehensive 2-5 paragraph overview of ALL topics in the wiki, not just the new source.",
        ].join("\n"),
```

- [ ] **Step 4: 替换 frontmatter type 列表 + 新增 project/domain 字段**

在 `"Required fields and types:"` 那一行之后，找到:
```typescript
    `  • type     — one of the known types (${GENERATION_WIKI_TYPES.join(" | ")}), or a custom type explicitly defined by the project schema`,
```

改为条件版本:
```typescript
    isExperience
      ? `  • type     — MUST be one of: ${EXPERIENCE_TYPES.join(" | ")}. Using "source", "entity", "concept", or any other non-experience type WILL be rejected.`
      : `  • type     — one of the known types (${GENERATION_WIKI_TYPES.join(" | ")}), or a custom type explicitly defined by the project schema`,
```

然后在 `  • sources  — array of source filenames; MUST include "${sourceFileName}".` 之后，追加:

```typescript
    isExperience
      ? [
          `  • project  — "${experienceMeta?.project || "unknown"}" (REQUIRED for all experience pages)`,
          `  • domain   — "${experienceMeta?.domain || "general"}" (REQUIRED for all experience pages)`,
        ].join("\n")
      : "",
```

- [ ] **Step 5: 修改 Concrete example（经验场景下）**

在 concrete example 段落后，如果是经验模式，添加经验专属的 body 结构提示。找到 `"Other rules:"` 部分，在它前面的 concrete example 之后、`"Other rules:"` 之前插入条件内容。

找到:
```typescript
    "Other rules:",
    "- Use [[wikilink]] syntax in the BODY for cross-references between pages",
```

在 `"Other rules:"` 后追加:

```typescript
    ...(isExperience
      ? [
          "- Experience page bodies MUST follow the structure specified in \"What to generate\" above",
          "- Every experience page MUST include the project and domain in frontmatter",
          "- Tag experience pages with relevant technical keywords for cross-project search",
        ]
      : []),
    "- Use [[wikilink]] syntax in the BODY for cross-references between pages",
```

- [ ] **Step 6: 验证 TypeScript 编译**

```bash
cd d:\work\llm_wiki && npx tsc --noEmit 2>&1 | head -20
```

Expected: No new errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/ingest.ts
git commit -m "feat: add isExperience parameter to buildGenerationPrompt"
```

---

### Task 5: `src/lib/ingest.ts` — 修改 `autoIngestImpl()` 调用点

**目标:** 在 Step 1 和 Step 2 的 LLM 调用中，检测经验源文件并传入正确的参数。同时跳过经验源文件的 source summary fallback。

**Files:**
- Modify: `src/lib/ingest.ts` — `autoIngestImpl()` 函数

- [ ] **Step 1: 在函数开头计算经验相关变量**

找到 `autoIngestImpl()` 中 `const sourceSummaryPath = ...` 之后，插入:

```typescript
  // ── Experience source detection ──
  const sourceIsExperience = isExperienceSource(sp)
  const experienceMeta = sourceIsExperience ? extractExperienceMeta(sourceContent) : undefined
  console.error(`[EXP-DEBUG-v6] sourceIsExperience=${sourceIsExperience} sourcePath="${sp}"`)
```

- [ ] **Step 2: 修改 Step 1（分析阶段）调用**

将:
```typescript
        { role: "system", content: buildAnalysisPrompt(purpose, index, sourceContext) },
```
改为:
```typescript
        { role: "system", content: buildAnalysisPrompt(purpose, index, sourceContext, sourceIsExperience, experienceMeta) },
```

- [ ] **Step 3: 修改 Step 2（生成阶段）调用**

将:
```typescript
      { role: "system", content: buildGenerationPrompt(schema, purpose, index, sourceIdentity, overview, sourceContext, sourceSummaryPath) },
```
改为:
```typescript
      { role: "system", content: buildGenerationPrompt(schema, purpose, index, sourceIdentity, overview, sourceContext, sourceSummaryPath, sourceIsExperience, experienceMeta) },
```

- [ ] **Step 4: 跳过经验源文件的 source summary fallback**

找到 `if (!hasSourceSummary && !signal?.aborted) {` 块，改为:

```typescript
  if (!hasSourceSummary && !signal?.aborted && !sourceIsExperience) {
```

（经验源文件不需要 source summary，LLM 已经被告知不要生成它）

- [ ] **Step 5: 验证 TypeScript 编译**

```bash
cd d:\work\llm_wiki && npx tsc --noEmit 2>&1 | head -20
```

Expected: No new errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ingest.ts
git commit -m "feat: wire experience source detection into autoIngestImpl"
```

---

### Task 6: `src/lib/wiki-schema.ts` + `src/lib/templates.ts` — 兜底约束

**目标:** 
- `wiki-schema.ts`: `validateWikiPageRouting` 拒绝 schema 中不存在的 type
- `templates.ts`: 新增 `experienceTemplate`

**Files:**
- Modify: `src/lib/wiki-schema.ts`
- Modify: `src/lib/templates.ts`

- [ ] **Step 1: wiki-schema.ts — 拒绝未知 type**

在 `validateWikiPageRouting()` 中，类型检查之后、目录检查之前，添加未知 type 拒绝逻辑。找到:

```typescript
  const parsed = parseFrontmatter(content)
  const type = parsed.frontmatter?.type
  if (typeof type !== "string" || !type.trim()) return null
```

在后面插入:

```typescript
  // Reject types not defined in the schema — prevents LLM from inventing
  // types (e.g. "source" when the schema only defines experience types).
  if (!(type in routing.typeDirs)) {
    const known = Object.keys(routing.typeDirs).join(", ")
    return {
      message: `Unknown page type "${type}" — not in schema. Known types: ${known}`,
    }
  }
```

- [ ] **Step 2: templates.ts — 新增 experienceTemplate**

在 `generalTemplate` 的定义之前插入。在 `const generalTemplate: WikiTemplate = {` 之前添加:

```typescript
const experienceTemplate: WikiTemplate = {
  id: "experience",
  name: "Experience",
  description: "Capture bugs, decisions, how-tos, agent errors, patterns, and templates from development sessions",
  icon: "🧠",
  extraDirs: ["wiki/bugs", "wiki/decisions", "wiki/howto", "wiki/agent-errors", "wiki/patterns", "wiki/templates"],
  schema: `# Wiki Schema — Project Experience

## Page Types

| Type | Directory | Purpose |
|------|-----------|---------|
| bug | wiki/bugs/ | Defects with symptoms → root cause → solution → prevention |
| decision | wiki/decisions/ | Architecture/technology choices with rationale and consequences |
| howto | wiki/howto/ | Repeatable procedures with steps and verification |
| agent-error | wiki/agent-errors/ | Claude Code mistakes and how they were corrected |
| pattern | wiki/patterns/ | Recurring bugs sharing a root cause (requires evidence from ≥2 occurrences) |
| template | wiki/templates/ | Reusable checklists and project setup guides |

## Naming Conventions

- Files: \`kebab-case.md\`
- Bugs: descriptive slug (e.g., \`hardfault-on-boot-vector-table.md\`)
- Decisions: \`NNN-slug.md\` (e.g., \`001-use-rtos-for-task-scheduling.md\`)
- How-to: action-oriented slug (e.g., \`setup-arm-gcc-toolchain.md\`)
- Agent errors: descriptive slug (e.g., \`wrong-linker-script-path.md\`)
- Patterns: pattern name (e.g., \`startup-code-symbol-conflict.md\`)
- Templates: template name (e.g., \`embedded-project-kickoff.md\`)

## Frontmatter

All pages must include YAML frontmatter:

\`\`\`yaml
---
type: bug | decision | howto | agent-error | pattern | template
title: Human-readable title
tags: []
related: []
project: "<source-project>"
domain: "<technical-domain>"
sources: []
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
\`\`\`

## Index Format

\`wiki/index.md\` lists all pages grouped by type:

\`\`\`
## Bugs
- [[page-slug]] — one-line description

## Decisions
- [[page-slug]] — one-line description

## How-To
- [[page-slug]] — one-line description

## Agent Errors
- [[page-slug]] — one-line description

## Patterns
- [[page-slug]] — one-line description

## Templates
- [[page-slug]] — one-line description
\`\`\`

## Log Format

\`wiki/log.md\` records activity in reverse chronological order:
\`\`\`
## YYYY-MM-DD

- ingest | session transcript processed
\`\`\`

## Cross-referencing Rules

- Use \`[[page-slug]]\` syntax to link between wiki pages
- Pattern pages MUST link to the bug/agent-error pages that form their evidence
- Template pages should link to relevant patterns for common pitfalls
- Bug pages that are part of a pattern should link back to the pattern page

## Contradiction Handling

When experience pages conflict:
1. Note the contradiction in the relevant page body
2. Different projects or environments may have different constraints — document the context that made each approach correct
3. If a pattern is disproven by new evidence, update its status and link to the counter-evidence
`,
  purpose: `# Project Purpose — Experience Accumulation

## Project

**Repository:** 
**Domain:** 
**Description:** 

## Why Track Experiences

<!-- What makes this project worth learning from? -->

## Current Focus

<!-- What aspect of the project are you most actively working on? -->

1.
2.
3.

## Experience Quality Guidelines

- **Bug pages:** Include exact error messages and stack traces when available
- **Decision pages:** Always list alternatives considered, not just the chosen option
- **How-to pages:** Must be reproducible — include exact commands and file paths
- **Agent-error pages:** Include what triggered the mistake (ambiguous prompt, missing context)
- **Pattern pages:** Requires ≥2 bug pages as evidence before creation
- **Template pages:** Should be battle-tested — don't create templates preemptively
`,
}
```

- [ ] **Step 3: 将 experienceTemplate 加入 templates 数组**

将:
```typescript
export const templates: WikiTemplate[] = [
  researchTemplate,
  readingTemplate,
  personalTemplate,
  businessTemplate,
  generalTemplate,
]
```
改为:
```typescript
export const templates: WikiTemplate[] = [
  researchTemplate,
  readingTemplate,
  personalTemplate,
  businessTemplate,
  experienceTemplate,
  generalTemplate,
]
```

- [ ] **Step 4: 验证 TypeScript 编译**

```bash
cd d:\work\llm_wiki && npx tsc --noEmit 2>&1 | head -20
```

Expected: No new errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/wiki-schema.ts src/lib/templates.ts
git commit -m "feat: add experience template and reject unknown types in schema validation"
```

---

## Verification

### 1. TypeScript 编译

```bash
cd d:\work\llm_wiki && npx tsc --noEmit
```
Expected: No errors.

### 2. Python 脚本测试

```bash
cd d:\work\llm_wiki && python tools/extract_experiences.py --transcript tools/test_transcript.jsonl --project test-project --domain test-domain --dry-run
```
Expected: 预览输出的 Markdown 内容，不写入文件。

### 3. 端到端 Ingest 测试

在测试项目中（如 `d:\work\116\`），确保 `schema.md` 中只定义了经验类型后：
1. 将 transcript 转换产物放入 `raw/sources/experiences/`
2. 触发 Ingest
3. 检查日志中 `[EXP-DEBUG-v6]` 输出 `sourceIsExperience=true`
4. 检查日志中 `[GEN-v8]` 输出 `isExperience=true`
5. 检查产出的 wiki 页面 type 为经验类型之一（非 `source`）
6. 检查页面 frontmatter 包含 `project` 和 `domain` 字段
