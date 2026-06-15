# 项目经验积累系统 — Phase 1 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 llm_wiki 项目经验积累系统完成最小可行实现：schema 扩展 + 经验提取脚本 + Hook 集成 + 自动触发规则。

**Architecture:** Phase 1 不修改 llm_wiki 核心管线（ingest/search/graph 不动），只在两个项目各做少量改动——llm_wiki 改 project.rs 模板，llm-wiki-agent 加提取脚本和 CLAUDE.md 规则。

**涉及项目:**
- `D:\work\llm_wiki` — Tauri 桌面应用（改 project.rs + wiki-page-types.ts）
- `D:\work\llm-wiki-agent` — Claude Code 桥接项目（新脚本 + Hook 集成 + CLAUDE.md）

**Tech Stack:** Rust (project.rs), TypeScript (wiki-page-types.ts), Python 3 (extract_experiences.py, capture_session.py), Markdown (CLAUDE.md)

---

## 文件结构

```
llm_wiki (D:\work\llm_wiki)
├── src-tauri/src/commands/project.rs    ← 改：schema.md 模板 + 新目录
└── src/lib/wiki-page-types.ts           ← 改：WIKI_TYPE_DIRS 加新类型映射

llm-wiki-agent (D:\work\llm-wiki-agent)
├── tools/extract_experiences.py         ← 新建：经验提取脚本
├── tools/capture_session.py             ← 改：SessionEnd 集成经验提取
└── CLAUDE.md                            ← 改：预加载 + 自动触发 + /exp 命令
```

---

### Task 1: llm_wiki — schema.md 模板扩展（project.rs）

**文件:** `D:\work\llm_wiki\src-tauri\src\commands\project.rs`

**改动范围:** 3 处——Page Types 表、创建目录列表、index.md 模板。

- [ ] **Step 1: 在 Page Types 表格中新增 6 行**

找到 `schema_content` 中的 Page Types 表格（约第 47-54 行），在 `| synthesis | wiki/synthesis/ | ...` 行之后、`## Naming Conventions` 之前，插入：

```rust
| bug | wiki/bugs/ | Code/hardware defects: symptom → root cause → fix |
| decision | wiki/decisions/ | Architecture/technology choices with rationale |
| howto | wiki/howto/ | Repeatable operational procedures |
| agent-error | wiki/agent-errors/ | Claude Code mistakes and corrections |
| pattern | wiki/patterns/ | Recurring pitfall: evidence list + prevention strategy |
| template | wiki/templates/ | Reusable project checklist with domain scoping |
```

完整替换后的 Page Types 表格应为 12 行（原有 6 行 + 新增 6 行）。

- [ ] **Step 2: 在 Frontmatter 规范中新增 project 和 domain 字段**

找到 frontmatter 示例代码块（约第 68-77 行），在 `updated: YYYY-MM-DD` 之后、`---` 结束符之前，加入：

```yaml
project: ""    # Source repo name, e.g. "smart-lock-firmware"
domain: ""     # Tech area for cross-project search, e.g. "embedded-arm"
```

注意：这是 Rust 的 `format!` 宏内的内容，所有 `{` `}` 需要正确转义。当前代码用 `r#"..."#` 原始字符串，不需要转义，但要确认 `project: ""` 中的双引号不会破坏 Rust 字符串语法。

- [ ] **Step 3: 在目录列表中新增 patterns 和 templates**

找到 `let dirs = [...]`（约第 24-33 行），在现有目录后追加两个目录：

```rust
"wiki/patterns",
"wiki/templates",
```

如果 `wiki/bugs`、`wiki/decisions`、`wiki/howto`、`wiki/agent-errors` 不在列表中，一并加入。

- [ ] **Step 4: 在 index.md 模板中新增 Patterns 和 Templates 章节**

找到 `let index_content = ...`（约第 155-168 行），在 `## Comparisons` 之后加入：

```markdown
## Bugs

## Decisions

## Howtos

## Agent Errors

## Patterns

## Templates
```

- [ ] **Step 5: 编译验证**

```bash
cd D:/work/llm_wiki/src-tauri && cargo check
```

预期：编译通过，无 warning（或仅有已有 warning）。

- [ ] **Step 6: 提交**

```bash
cd D:/work/llm_wiki
git add src-tauri/src/commands/project.rs
git commit -m "feat: add experience page types and project/domain fields to schema template"
```

---

### Task 2: llm_wiki — wiki-page-types.ts 类型映射更新

**文件:** `D:\work\llm_wiki\src\lib\wiki-page-types.ts`

**改动范围:** `WIKI_TYPE_DIRS` 数组，追加新类型的目录→类型映射。

- [ ] **Step 1: 在 WIKI_TYPE_DIRS 中追加新条目**

在 `{ dir: "methodology", type: "methodology" }` 之后追加：

```typescript
  { dir: "bugs", type: "bug" },
  { dir: "decisions", type: "decision" },
  { dir: "howto", type: "howto" },
  { dir: "agent-errors", type: "agent-error" },
  { dir: "patterns", type: "pattern" },
  { dir: "templates", type: "template" },
```

注意：现有代码的 `customDir` 回退逻辑（第 34-35 行）可以处理未知目录，但显式映射确保 `inferWikiTypeFromPath` 返回精确的 type 值（如 "bug" 而非 "bugs"）。

- [ ] **Step 2: 类型检查**

```bash
cd D:/work/llm_wiki && npx tsc --noEmit
```

预期：无新增类型错误。

- [ ] **Step 3: 提交**

```bash
cd D:/work/llm_wiki
git add src/lib/wiki-page-types.ts
git commit -m "feat: add experience type directory mappings to wiki-page-types"
```

---

### Task 3: llm-wiki-agent — 新建 extract_experiences.py

**文件:** `D:\work\llm-wiki-agent\tools\extract_experiences.py`（新建）

- [ ] **Step 1: 创建脚本骨架**

```python
#!/usr/bin/env python3
"""
从 Claude Code transcript JSONL 中提取结构化项目经验。

用法：
    python tools/extract_experiences.py --transcript <jsonl_path> [options]

选项：
    --transcript      Transcript JSONL 文件路径（必需）
    --project         项目名，默认从 LLM_WIKI_PROJECT 环境变量读取
    --domain          技术领域，默认从 LLM_WIKI_DOMAIN 环境变量读取
    --output-dir      输出目录，默认 raw/sources/experiences/
    --dry-run         只分析不写入
    --api-base        LLM API base URL（默认 http://localhost:11434/v1）
    --api-key         LLM API key
    --model           LLM 模型名（默认 deepseek-v4-pro）
"""
```

- [ ] **Step 2: 实现 JSONL 读取与噪音过滤**

```python
import json
import os
import sys
import re
import argparse
from datetime import datetime
from pathlib import Path


def load_transcript(path: Path) -> list[dict]:
    """读取 JSONL transcript，返回过滤后的有意义消息列表。"""
    messages = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue

            # 跳过系统事件
            t = obj.get("type", "")
            if t in ("mode", "queue-operation", "file-history-snapshot", "last-prompt"):
                continue
            if t == "attachment":
                at = obj.get("attachment", {}).get("type", "")
                if at in ("skill_listing", "hook_success", "hook_additional_context",
                          "hook_non_blocking_error"):
                    continue
            if t == "system":
                st = obj.get("subtype", "")
                if st in ("local_command", "stop_hook_summary"):
                    continue
            if obj.get("isMeta"):
                continue

            # 跳过思考过程
            if t == "assistant":
                content = obj.get("message", {}).get("content", [])
                if isinstance(content, list):
                    has_thinking_only = all(
                        c.get("type") == "thinking" for c in content
                    )
                    if has_thinking_only:
                        continue
                    # 过滤掉 thinking 块
                    content = [c for c in content if c.get("type") != "thinking"]
                    obj["message"]["content"] = content

            messages.append(obj)
    return messages
```

- [ ] **Step 3: 实现按主题分块**

```python
def chunk_by_topic(messages: list[dict], max_chars: int = 8000) -> list[list[dict]]:
    """按 user 消息切分 transcript 为独立主题块。"""
    chunks = []
    current = []
    current_len = 0

    for msg in messages:
        msg_text = _estimate_msg_length(msg)
        if msg.get("type") == "user" and current_len > max_chars:
            # 新的 user 消息且当前块已够大 → 切分
            if current:
                chunks.append(current)
            current = [msg]
            current_len = msg_text
        else:
            current.append(msg)
            current_len += msg_text

    if current:
        chunks.append(current)
    return chunks


def _estimate_msg_length(msg: dict) -> int:
    """估算单条消息的文本长度。"""
    content = msg.get("message", {}).get("content", "")
    if isinstance(content, list):
        return sum(len(c.get("text", "")) for c in content if c.get("type") in ("text", "tool_result"))
    if isinstance(content, str):
        return len(content)
    return 0
```

- [ ] **Step 4: 实现 LLM 调用与经验提取 prompt**

```python
import urllib.request
import urllib.error


EXPERIENCE_EXTRACTION_PROMPT = """你正在分析一段 Claude Code 对话 transcript，从中提取项目经验。
当前项目："{project_name}"，所属领域："{domain}"。

## 提取标准

只提取**明确可复用**的经验。不确定的内容不要强行提取。

对于每条经验，输出一个 FILE 块：

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

# <title>

## 现象 / 背景
<发生了什么，用户当时在做什么>

## 根因
<底层原因，技术细节>

## 解决方案
<如何解决的，具体命令或代码>

## 预防措施
<以后如何避免此问题>
===END

## 类型选择指南

- **bug**：代码/硬件缺陷，有明确的错误信息和修复方案
- **decision**：架构选型、技术取舍的讨论（需要记录"为什么这样选"）
- **howto**：可复现的操作序列（环境配置、命令组合等）
- **agent-error**：Claude Code 自身的错误及纠正方式（不是项目 bug，是 Claude 犯错）
- **pattern**：如果某类问题看起来会重复出现，使用 pattern 类型；
          额外添加 "## 证据" 章节

## 输出格式

- 如果 extract 到经验：只输出 FILE 块，不要多余文字
- 如果没有任何可提取内容：只输出一行 NO_EXPERIENCES

注意：
- 相同的 bug/决策如果已经讨论过，不要重复提取
- 避免提取过于琐碎的内容（如"改了个变量名"）
- tags 使用英文小写，用连字符连接多词标签
"""


def call_llm(prompt: str, transcript_text: str, api_base: str, api_key: str, model: str) -> str:
    """调用 LLM API 进行经验提取。"""
    url = f"{api_base.rstrip('/')}/chat/completions"
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": prompt},
            {"role": "user", "content": f"## Transcript 片段\n\n{transcript_text}"},
        ],
        "temperature": 0.3,
        "max_tokens": 4096,
    }
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    })
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            return result["choices"][0]["message"]["content"]
    except urllib.error.HTTPError as e:
        print(f"[ERROR] LLM API HTTP {e.code}: {e.read().decode()[:500]}", file=sys.stderr)
        raise
    except Exception as e:
        print(f"[ERROR] LLM API 调用失败: {e}", file=sys.stderr)
        raise
```

- [ ] **Step 5: 实现 FILE 块解析与文件写入**

```python
FILE_BLOCK_RE = re.compile(
    r"===FILE\s+wiki/([^\s]+\.md)\s*\n(.*?)\n===END",
    re.DOTALL,
)


def parse_file_blocks(llm_output: str) -> list[tuple[str, str]]:
    """从 LLM 输出中解析 FILE 块，返回 [(相对路径, 内容), ...]."""
    return [(m.group(1), m.group(2).strip()) for m in FILE_BLOCK_RE.finditer(llm_output)]


def dedup_against_existing(output_dir: Path, pages: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """简单的标题去重：检查输出目录下是否已有同名文件。"""
    result = []
    for rel_path, content in pages:
        target = output_dir / rel_path
        if target.exists():
            print(f"[SKIP] 已存在: {rel_path}")
            continue
        result.append((rel_path, content))
    return result


def write_pages(output_dir: Path, pages: list[tuple[str, str]]) -> list[str]:
    """写入经验页面，返回已写入的文件路径列表。"""
    written = []
    for rel_path, content in pages:
        target = output_dir / rel_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        print(f"[WRITE] {target}")
        written.append(str(target))
    return written
```

- [ ] **Step 6: 实现 main() 入口**

```python
def main():
    parser = argparse.ArgumentParser(description="从 Claude Code transcript 提取项目经验")
    parser.add_argument("--transcript", required=True, help="Transcript JSONL 文件路径")
    parser.add_argument("--project", default=os.environ.get("LLM_WIKI_PROJECT", "default"))
    parser.add_argument("--domain", default=os.environ.get("LLM_WIKI_DOMAIN", "general"))
    parser.add_argument(
        "--output-dir",
        default=None,
        help="输出目录（默认从 LLM_WIKI_ROOT 环境变量推导）",
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--api-base", default=os.environ.get("LLM_API_BASE", "http://localhost:11434/v1"))
    parser.add_argument("--api-key", default=os.environ.get("LLM_API_KEY", "ollama"))
    parser.add_argument("--model", default=os.environ.get("LLM_MODEL", "deepseek-v4-pro"))
    args = parser.parse_args()

    transcript_path = Path(args.transcript)
    if not transcript_path.exists():
        print(f"[ERROR] Transcript 文件不存在: {transcript_path}", file=sys.stderr)
        sys.exit(1)

    # 确定输出目录
    if args.output_dir:
        output_dir = Path(args.output_dir)
    else:
        llm_wiki_root = os.environ.get("LLM_WIKI_ROOT", "D:/work/llm_wiki_project")
        output_dir = Path(llm_wiki_root) / "raw" / "sources" / "experiences"

    today = datetime.now().strftime("%Y-%m-%d")

    # 加载并过滤
    print(f"[INFO] 加载 transcript: {transcript_path}")
    messages = load_transcript(transcript_path)
    meaningful = [m for m in messages if m.get("type") in ("user", "assistant")]
    print(f"[INFO] {len(messages)} 条消息 → {len(meaningful)} 条有意义消息")

    # 格式化为文本
    transcript_text = format_messages_as_text(meaningful)
    if len(transcript_text) < 100:
        print("[INFO] Transcript 内容过短，跳过")
        return

    # 构建 prompt
    prompt = EXPERIENCE_EXTRACTION_PROMPT.format(
        project_name=args.project,
        domain=args.domain,
        today=today,
    )

    # 分块处理
    chunks = chunk_by_topic(meaningful, max_chars=8000)
    print(f"[INFO] 分为 {len(chunks)} 个主题块")

    all_files = []
    for i, chunk in enumerate(chunks):
        chunk_text = format_messages_as_text(chunk)
        if len(chunk_text) < 200:
            continue

        print(f"[INFO] 处理第 {i+1}/{len(chunks)} 块 ({len(chunk_text)} chars)...")
        try:
            llm_output = call_llm(prompt, chunk_text, args.api_base, args.api_key, args.model)
        except Exception:
            print(f"[WARN] 第 {i+1} 块 LLM 调用失败，跳过")
            continue

        if "NO_EXPERIENCES" in llm_output:
            print(f"[INFO] 第 {i+1} 块无经验可提取")
            continue

        pages = parse_file_blocks(llm_output)
        if not pages:
            continue

        pages = dedup_against_existing(output_dir, pages)
        if args.dry_run:
            for rel_path, _ in pages:
                print(f"[DRY-RUN] 将写入: {rel_path}")
        else:
            written = write_pages(output_dir, pages)
            all_files.extend(written)

    print(f"[DONE] 提取完成：{len(all_files)} 条新经验")


def format_messages_as_text(messages: list[dict]) -> str:
    """将消息列表格式化为 LLM 可读的文本。"""
    lines = []
    for msg in messages:
        t = msg.get("type", "")
        role = "用户" if t == "user" else "Claude"
        content = msg.get("message", {}).get("content", "")
        if isinstance(content, list):
            texts = []
            for c in content:
                if c.get("type") == "text":
                    texts.append(c.get("text", ""))
                elif c.get("type") == "tool_result":
                    result_text = c.get("content", "")
                    if isinstance(result_text, str) and result_text:
                        texts.append(f"[工具输出] {result_text[:500]}")
            content = "\n".join(texts)
        if isinstance(content, str) and content.strip():
            lines.append(f"**{role}:** {content[:1000]}")
    return "\n\n".join(lines)


if __name__ == "__main__":
    main()
```

- [ ] **Step 7: 提交**

```bash
cd D:/work/llm-wiki-agent
git add tools/extract_experiences.py
git commit -m "feat: add experience extraction script for Claude Code transcripts"
```

---

### Task 4: llm-wiki-agent — SessionEnd Hook 集成经验提取

**文件:** `D:\work\llm-wiki-agent\tools\capture_session.py`

**改动范围:** `convert_and_sync_to_llm_wiki()` 函数末尾，追加经验提取调用。

- [ ] **Step 1: 在 convert_and_sync_to_llm_wiki 末尾追加经验提取调用**

在 `convert_and_sync_to_llm_wiki` 函数中，`log(...)` 这一行之后、函数结束之前（约第 287 行），追加：

```python
    # ---- Phase 1: 经验提取 ----
    try:
        extract_script = project_root / "tools" / "extract_experiences.py"
        if extract_script.exists():
            llm_wiki_project = os.environ.get("LLM_WIKI_PROJECT", "default")
            llm_wiki_domain = os.environ.get("LLM_WIKI_DOMAIN", "general")
            import subprocess
            result = subprocess.run(
                [
                    sys.executable,
                    str(extract_script),
                    "--transcript", str(md_path),  # 用已生成的 Markdown 文件（而非 JSONL）
                    "--project", llm_wiki_project,
                    "--domain", llm_wiki_domain,
                ],
                capture_output=True,
                text=True,
                timeout=300,  # 5 分钟超时
            )
            if result.returncode == 0:
                log(f"经验提取完成:\n{result.stdout[-500:]}")
            else:
                log(f"经验提取失败 (exit={result.returncode}):\n{result.stderr[-500:]}")
        else:
            log(f"经验提取脚本不存在: {extract_script}")
    except Exception:
        log(f"经验提取异常:\n{traceback.format_exc()}")
```

注意：需要确认文件顶部已有 `import os` 和 `import subprocess`。当前文件中 `os` 已导入，`subprocess` 未导入——需在文件开头 `import shutil` 之后添加：

```python
import subprocess
```

- [ ] **Step 2: 提交**

```bash
cd D:/work/llm-wiki-agent
git add tools/capture_session.py
git commit -m "feat: integrate experience extraction into SessionEnd hook"
```

---

### Task 5: llm-wiki-agent — CLAUDE.md 经验系统规则

**文件:** `D:\work\llm-wiki-agent\CLAUDE.md`

**改动范围:** 三处追加——KB-Loader 预加载、自动触发规则、`/exp` 命令。

- [ ] **Step 1: KB-Loader 预加载——在"二、KB-Loader 预加载"章节最前面插入 Step 0**

在 `1. 如果 ../master-kb/wiki/index.md 存在...` 之前插入：

```markdown
0. **（经验预加载）** 如果环境变量 `LLM_WIKI_PROJECT` 已设置，通过 MCP 搜索本项目相关经验：
   - 调用 `llm_wiki_search`，query = `LLM_WIKI_PROJECT` + `LLM_WIKI_DOMAIN` 的值
   - 取 top 5 结果，提取标题和一行摘要
   - 如果找到结果，告知用户："📚 该项目有 N 条相关历史经验"
   - 将经验标题和摘要保持在上下文中，供后续自动触发时参考
```

- [ ] **Step 2: 在"三、触发行为"末尾新增触发 7——自动触发规则**

在触发 6（Summarize）之后追加：

```markdown
### 触发 7：Experience Auto-Trigger（经验自动触发）
**触发条件：** 会话中遇到以下情况时**自动触发**（无需用户显式命令）

**自动搜索条件：**
1. **编译/运行时错误** — 错误信息包含 "error"、"failed"、"panic"、"cannot"、"undefined" 等
2. **配置文件问题** — 配置不生效、格式报错
3. **环境依赖问题** — 找不到工具、版本不兼容
4. **重复性工作** — 用户明确问"上次怎么做的"、"有没有遇到过"

**动作：**
1. 提取错误关键词或问题关键词
2. 调用 `llm_wiki_search`（通过 MCP）
3. 如果有匹配结果 → 告知用户："⚠️ 知识库有相关经验：[[PageName]] — {摘要}"
4. 如果无匹配 → 继续正常排错流程
5. 问题解决后 → 如果这是新经验，提醒用户可用 `/exp` 记录
```

- [ ] **Step 3: 在"三、触发行为"末尾新增触发 8——/exp 手动提炼**

```markdown
### 触发 8：Exp（手动提炼经验）
**触发词：** `/exp` 或 "提炼经验" 或 "记录这个坑"

**动作：**
1. 获取当前会话中最近的问题/讨论上下文
2. 询问用户要记录的类型（bug / decision / howto / agent-error / pattern）
3. 按以下结构生成页面，写入 wiki/ 对应目录：
   ```
   现象/背景 → 根因 → 解决方案 → 预防措施
   ```
4. Frontmatter 中包含 `type`、`project`、`domain`、`tags`
5. 更新 `wiki/index.md` 对应章节
6. 追加 `wiki/log.md`：`## [YYYY-MM-DD] exp | <标题>`

**目的：** 当自动提取脚本漏掉或用户觉得某件事特别重要时的补充手段。
```

- [ ] **Step 4: 在"一、目录职责"的 wiki/ 段落下补充新目录说明**

在 `wiki/syntheses/` 一行之后追加：

```markdown
  - `wiki/patterns/` — 重复出现的坑（证据列表 + 预防策略）
  - `wiki/templates/` — 可复用项目检查清单
```

- [ ] **Step 5: 在"四、页面模板"章节末尾追加 Pattern 和 Template 模板**

```markdown
### Pattern（patterns/）
```
建议章节：概述 → 证据（[[PageName]] 列表） → 根因模式 → 预防策略 → 检测特征
```
额外可加字段：`project`、`domain`

### Template（templates/）
```
建议章节：适用范围 → 前置条件 → 步骤/Checklist → 常见坑点
```
额外可加字段：`project`、`domain`、`applies_to`
```

- [ ] **Step 6: 提交**

```bash
cd D:/work/llm-wiki-agent
git add CLAUDE.md
git commit -m "feat: add experience system rules to CLAUDE.md (preload + auto-trigger + /exp)"
```

---

## 验证清单

完成所有 Task 后执行：

1. **llm_wiki 编译验证:**
   ```bash
   cd D:/work/llm_wiki/src-tauri && cargo check
   cd D:/work/llm_wiki && npx tsc --noEmit
   ```
   预期：均通过。

2. **脚本可运行性:**
   ```bash
   cd D:/work/llm-wiki-agent
   python tools/extract_experiences.py --help
   ```
   预期：打印 usage 信息。

3. **创建新项目测试:**
   - 打开 llm_wiki 桌面应用
   - 创建新项目
   - 检查 `schema.md` 是否包含 pattern/template 类型和 project/domain 字段
   - 检查 `wiki/patterns/` 和 `wiki/templates/` 目录是否存在
   - 检查 `wiki/index.md` 是否包含 Patterns 和 Templates 章节

4. **端到端测试:**
   - 在 llm-wiki-agent 项目中设置环境变量 `LLM_WIKI_PROJECT=test-project`
   - 手动运行 `python tools/capture_session.py <session_id>`（用已有的 transcript）
   - 检查 `raw/sources/experiences/` 是否生成了 .md 文件
