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
                print(f"    警告: 跳过无效 JSON 行 {len(messages)+1}", file=sys.stderr)
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


def build_markdown(messages: list[dict], project: str, domain: str, today: str) -> str:
    """将消息列表构建为完整 Markdown 文件。"""

    parts = [
        "---",
        f'project: "{project}"',
        f'domain: "{domain}"',
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

def write_output(output_dir: str, content: str, project: str, transcript_path: str, today: str) -> str:
    """将 Markdown 内容写入文件。返回写入路径。"""
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

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
    today = datetime.now().strftime("%Y-%m-%d")

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
    content = build_markdown(messages, args.project, args.domain, today)
    print(f"      生成 {len(content)} 字符")

    print(f"[3/3] 写入文件...")
    if args.dry_run:
        print(f"    [dry-run] 预览前 500 字符:")
        print(content[:500])
        print(f"\n[dry-run] 共 {len(content)} 字符（未写入）")
    else:
        path = write_output(str(output_dir), content, args.project, args.transcript, today)
        print(f"    写入: {path}")
        print(f"\n完成！Ingest 管线将自动检测并处理此文件。")


if __name__ == "__main__":
    main()
