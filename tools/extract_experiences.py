#!/usr/bin/env python3
"""
extract_experiences.py — 从 Claude Code transcript 提取项目经验

读取 Claude Code 会话 transcript JSONL，调用 LLM 提取结构化经验，
写入 raw/sources/experiences/ 目录。

用法:
    python tools/extract_experiences.py \
        --transcript /path/to/transcript.jsonl \
        --project smart-lock-firmware \
        --domain embedded-arm \
        --output-dir /path/to/wiki/raw/sources/experiences

依赖: pip install httpx
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
        # tool_result / tool_use 的 content 可能是数组
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
# 2. 按主题分块
# ---------------------------------------------------------------------------

MAX_CHUNK_CHARS = 16_000  # 每块最大字符数，留有 prompt 空间


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
                # tool_use 也保留名称和输入
                if block.get("type") == "tool_use":
                    name = block.get("name", "")
                    inp = block.get("input", {})
                    parts.append(f"[tool_use: {name}] {json.dumps(inp, ensure_ascii=False)}")
                if block.get("type") == "tool_result":
                    parts.append(f"[tool_result] {block.get('content','')}")
        return "\n".join(parts)
    return str(content)


def format_msg(msg: dict, idx: int) -> str:
    """格式化单条消息为 prompt 可读文本。"""
    role = msg.get("role", "unknown")
    text = extract_text(msg)
    if len(text) > 4000:
        text = text[:4000] + "\n... [truncated]"
    return f"[{idx}] {role}:\n{text}\n"


def split_into_chunks(messages: list[dict]) -> list[list[dict]]:
    """按字符数将消息列表切分为多个 chunk。"""
    chunks = []
    current: list[dict] = []
    current_len = 0

    for msg in messages:
        msg_len = len(format_msg(msg, 0))
        if current_len + msg_len > MAX_CHUNK_CHARS and current:
            chunks.append(current)
            current = []
            current_len = 0
        current.append(msg)
        current_len += msg_len

    if current:
        chunks.append(current)

    return chunks


# ---------------------------------------------------------------------------
# 3. LLM 经验提取
# ---------------------------------------------------------------------------

EXTRACTION_PROMPT = """你正在分析一段 Claude Code 对话 transcript，从中提取项目经验。
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
          并包含 "## 证据" 章节列出相关事件

如果 transcript 中没有可提取的经验，输出：
NO_EXPERIENCES
"""


def build_chunk_prompt(
    messages: list[dict],
    project_name: str,
    domain: str,
    existing_titles: list[str],
) -> str:
    """为单个 chunk 构建 prompt。"""
    today = datetime.now().strftime("%Y-%m-%d")
    prompt = EXTRACTION_PROMPT.format(
        project_name=project_name,
        domain=domain,
        today=today,
    )

    # 附加已有页面列表（用于去重提示）
    if existing_titles:
        prompt += "\n## 已有经验页面（请避免重复）\n"
        for t in existing_titles:
            prompt += f"- {t}\n"

    prompt += "\n## Transcript 片段\n\n"
    for i, msg in enumerate(messages):
        prompt += format_msg(msg, i)

    return prompt


def parse_file_blocks(response: str) -> list[dict]:
    """解析 LLM 输出的 ===FILE ... ===END 块。"""
    if "NO_EXPERIENCES" in response.upper():
        return []

    # 匹配 ===FILE path=== ... ===END 或 ---FILE: path--- ... ---END FILE---
    pattern = r"(?:===FILE\s+(.+?)===|===FILE\s+(.+?)\n|FILE:\s*(.+?)\s*\n---)\s*\n(.*?)(?:===END|===END FILE===|END FILE---)"
    matches = re.findall(pattern, response, re.DOTALL | re.IGNORECASE)

    results = []
    for m in matches:
        path = (m[0] or m[1] or m[2]).strip()
        content = m[3].strip()
        if path and content:
            results.append({"path": path, "content": content})

    # Fallback: 尝试匹配 ```markdown 代码块
    if not results:
        code_block_pattern = r"```(?:markdown|yaml)?\s*\n(---[\s\S]*?---[\s\S]*?)```"
        code_blocks = re.findall(code_block_pattern, response)
        for i, block in enumerate(code_blocks):
            # 尝试从 frontmatter 提取类型和标题
            fm_match = re.match(
                r"---\s*\n.*?type:\s*(\S+).*?\ntitle:\s*(.+?)\n.*?---",
                block,
                re.DOTALL,
            )
            if fm_match:
                exp_type = fm_match.group(1).strip()
                title = (
                    fm_match.group(2).strip().strip('"').strip("'")
                )
                slug = re.sub(r"[^\w\-]+", "-", title.lower()).strip("-")
                type_dir_map = {
                    "bug": "bugs",
                    "decision": "decisions",
                    "howto": "howto",
                    "agent-error": "agent-errors",
                    "pattern": "patterns",
                    "template": "templates",
                }
                dir_name = type_dir_map.get(exp_type, "bugs")
                path = f"wiki/{dir_name}/{slug}.md"
                results.append({"path": path, "content": block.strip()})

    return results


async def call_llm(
    prompt: str,
    api_base: str,
    api_key: str,
    model: str,
) -> str:
    """调用 LLM API。"""
    import httpx

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": model,
        "messages": [
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.3,
        "max_tokens": 4096,
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            f"{api_base.rstrip('/')}/v1/chat/completions",
            headers=headers,
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]


# ---------------------------------------------------------------------------
# 4. 去重
# ---------------------------------------------------------------------------


def hash_title(title: str) -> str:
    """对标题做归一化哈希用于去重。"""
    normalized = re.sub(r"[^\w]+", "-", title.lower()).strip("-")
    return hashlib.sha256(normalized.encode()).hexdigest()[:16]


def scan_existing_titles(wiki_root: str) -> list[str]:
    """扫描 wiki/ 下所有经验页面的标题。"""
    titles = []
    exp_dirs = ["bugs", "decisions", "howto", "agent-errors", "patterns", "templates"]
    wiki_path = Path(wiki_root) / "wiki"
    if not wiki_path.exists():
        return titles

    for dir_name in exp_dirs:
        dir_path = wiki_path / dir_name
        if not dir_path.exists():
            continue
        for md_file in dir_path.glob("*.md"):
            try:
                content = md_file.read_text(encoding="utf-8")
                fm_match = re.match(
                    r"^---\s*\n.*?title:\s*(.+?)\n.*?---",
                    content,
                    re.DOTALL | re.MULTILINE,
                )
                if fm_match:
                    titles.append(fm_match.group(1).strip().strip('"').strip("'"))
                else:
                    # Fallback: 用文件名
                    titles.append(md_file.stem)
            except Exception:
                continue

    return titles


# ---------------------------------------------------------------------------
# 5. 写入
# ---------------------------------------------------------------------------


def write_experience(output_dir: str, file_block: dict) -> str:
    """将单条经验写入 .md 文件。返回写入路径。"""
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    # 从 content 中提取类型和标题生成文件名
    content = file_block["content"]
    fm_match = re.match(
        r"---\s*\n.*?type:\s*(\S+).*?\ntitle:\s*(.+?)\n.*?---",
        content,
        re.DOTALL,
    )

    if fm_match:
        title = fm_match.group(2).strip().strip('"').strip("'")
    else:
        title = file_block["path"].split("/")[-1].replace(".md", "")

    today = datetime.now().strftime("%Y-%m-%d")
    slug = re.sub(r"[^\w\-]+", "-", title.lower()).strip("-")[:80]
    filename = f"{today}-{slug}.md"
    filepath = out_path / filename

    filepath.write_text(content, encoding="utf-8")
    return str(filepath)


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------


async def main():
    parser = argparse.ArgumentParser(
        description="从 Claude Code transcript 提取项目经验"
    )
    parser.add_argument(
        "--transcript", required=True, help="Transcript JSONL 文件路径"
    )
    parser.add_argument(
        "--project", default="default", help="来源项目名"
    )
    parser.add_argument(
        "--domain", default="general", help="技术领域"
    )
    parser.add_argument(
        "--output-dir",
        default=None,
        help="输出目录（默认: transcript 同级目录下的 raw/sources/experiences/）",
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="只打印结果，不写入文件"
    )
    parser.add_argument(
        "--api-base",
        default=os.environ.get("LLM_API_BASE", "https://api.anthropic.com"),
        help="LLM API 端点",
    )
    parser.add_argument(
        "--api-key",
        default=os.environ.get("LLM_API_KEY", ""),
        help="LLM API Key",
    )
    parser.add_argument(
        "--model",
        default=os.environ.get("LLM_MODEL", "claude-fable-5"),
        help="LLM 模型名称",
    )
    args = parser.parse_args()

    # 确定输出目录
    if args.output_dir:
        output_dir = args.output_dir
    else:
        transcript_dir = Path(args.transcript).parent
        output_dir = transcript_dir / "raw" / "sources" / "experiences"

    print(f"[1/5] 读取 transcript: {args.transcript}")
    messages = load_transcript(args.transcript)
    print(f"      有效消息: {len(messages)} 条")

    if not messages:
        print("      没有有效消息，退出。")
        return

    print(f"[2/5] 分块处理...")
    chunks = split_into_chunks(messages)
    print(f"      分为 {len(chunks)} 个 chunk")

    print(f"[3/5] 扫描已有经验页面（去重）...")
    # 从 output_dir 反推 wiki 根目录
    wiki_root = Path(output_dir).parent.parent.parent
    existing_titles = scan_existing_titles(str(wiki_root))
    print(f"      已有 {len(existing_titles)} 条经验页面")

    if not args.api_key:
        print("[!] 未设置 LLM API Key（通过 --api-key 或 LLM_API_KEY 环境变量）")
        print("    将以 dry-run 模式运行，跳过 LLM 调用。")
        args.dry_run = True

    all_experiences: list[dict] = []

    for i, chunk in enumerate(chunks):
        if args.dry_run or not args.api_key:
            chunk_text = "\n".join(format_msg(m, j) for j, m in enumerate(chunk))
            print(
                f"\n--- Chunk {i+1}/{len(chunks)} "
                f"({len(chunk)} msgs, {len(chunk_text)} chars) ---"
            )
            print(chunk_text[:500] + ("..." if len(chunk_text) > 500 else ""))
            continue

        print(f"\n    调用 LLM（chunk {i+1}/{len(chunks)}）...")
        prompt = build_chunk_prompt(chunk, args.project, args.domain, existing_titles)

        try:
            response = await call_llm(prompt, args.api_base, args.api_key, args.model)
        except Exception as e:
            print(f"    [!] LLM 调用失败: {e}")
            continue

        blocks = parse_file_blocks(response)
        print(f"    提取到 {len(blocks)} 条经验")

        for block in blocks:
            # 提取标题做去重
            title_match = re.search(r"title:\s*(.+)", block["content"])
            if title_match:
                title = title_match.group(1).strip().strip('"').strip("'")
                h = hash_title(title)
                existing_hashes = {hash_title(t) for t in existing_titles}
                if h in existing_hashes:
                    print(f"    [去重] 跳过重复经验: {title}")
                    continue
                existing_titles.append(title)

            all_experiences.append(block)

    print(f"\n[4/5] 去重后共 {len(all_experiences)} 条经验")

    print(f"[5/5] 写入文件...")
    written = []
    for exp in all_experiences:
        if args.dry_run:
            print(f"    [dry-run] {exp['path']}")
            print(f"    {exp['content'][:200]}...")
        else:
            path = write_experience(str(output_dir), exp)
            written.append(path)
            print(f"    写入: {path}")

    if args.dry_run:
        print(f"\n[dry-run] 共 {len(all_experiences)} 条经验（未写入）")
    else:
        print(f"\n完成！共写入 {len(written)} 条经验到 {output_dir}")
        if not written:
            print("本次 transcript 中未发现新经验。")

    return all_experiences


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
