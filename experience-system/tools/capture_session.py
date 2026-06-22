#!/usr/bin/env python3
"""
SessionEnd Hook 触发：存档 Claude Code transcript JSONL + 提取项目经验。

用法：
    python tools/capture_session.py --stdin
    python tools/capture_session.py <session_id> [--transcript <path>]

--stdin 模式（推荐）：
    Claude Code 的 SessionEnd Hook 会把 transcript_path 通过 stdin JSON 传入。
    Hook 配置 (.claude/settings.json)：
    {
      "hooks": {
        "SessionEnd": [{
          "matcher": "",
          "hooks": [{
            "type": "command",
            "command": "python D:/work/llm-wiki-agent/tools/capture_session.py --stdin"
          }]
        }]
      }
    }

环境变量（可选）：
    LLM_WIKI_PROJECT  — 项目名（默认从 cwd 推断）
    LLM_WIKI_DOMAIN   — 技术领域（默认 "general"）
    LLM_WIKI_ROOT     — llm_wiki 安装目录，用于找到 extract_experiences.py（默认 "D:/work/llm_wiki"）
    LLM_WIKI_OUTPUT_DIR — 经验输出到哪个 wiki 项目的 raw/sources/experiences/
                           （默认使用 LLM_WIKI_ROOT 项目的 KB_ROOT）
"""

import json
import os
import re
import shutil
import sys
import traceback
from datetime import datetime
from pathlib import Path


LOG_FILE = None  # 延迟初始化


def log(msg: str) -> None:
    """写入调试日志（仅当出错时有用）。"""
    global LOG_FILE
    if LOG_FILE is None:
        log_dir = Path(__file__).resolve().parent
        LOG_FILE = log_dir / "capture_session.log"
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    try:
        with open(LOG_FILE, "a", encoding="utf-8", errors="replace") as f:
            f.write(f"[{timestamp}] {msg}\n")
    except Exception:
        pass  # 日志写入失败不应中断主流程


def get_project_slug(project_root: Path) -> str:
    """将项目路径转换为 Claude Code 的项目 slug。

    规则：将绝对路径中的特殊字符替换为连字符。
    例如 d:\\work → d--work, /home/user/project → ---home-user-project
    """
    path_str = str(project_root.resolve())
    slug = path_str.replace(":", "").replace("\\", "-").replace("/", "-")
    slug = slug.lstrip("-")
    return slug


def find_transcript(session_id: str, project_root: Path) -> Path | None:
    """查找 Claude Code 的 transcript 文件。

    搜索策略：
    1. 遍历 ~/.claude/projects/*/ 下所有项目目录（因为 Hook 脚本位置 ≠ Claude 工作目录）
    2. 优先按 session_id 精确匹配
    3. Fallback：所有项目中最近 1 小时内修改的 .jsonl
    """
    home = Path.home()
    projects_dir = home / ".claude" / "projects"

    if not projects_dir.exists():
        log(f"projects 目录不存在: {projects_dir}")
        return None

    # 收集所有项目目录下的 .jsonl 文件
    all_jsonl = list(projects_dir.glob("*/*.jsonl"))
    if not all_jsonl:
        log(f"{projects_dir} 下未找到任何 .jsonl 文件")
        return None

    # 优先：按 session_id 精确匹配（跨所有项目）
    for f in all_jsonl:
        if session_id in f.name:
            log(f"精确匹配: {f}")
            return f

    # Fallback：所有项目中最近 1 小时内修改的
    cutoff = datetime.now().timestamp() - 3600
    recent = [f for f in all_jsonl if f.stat().st_mtime > cutoff]
    if recent:
        best = sorted(recent, key=lambda x: x.stat().st_mtime, reverse=True)[0]
        log(f"时间匹配（最近修改）: {best}")
        return best

    log(f"在所有项目目录中未找到匹配 session_id={session_id[:16]} 的文件（共 {len(all_jsonl)} 个 jsonl）")
    return None


def main():
    project_root = Path(__file__).resolve().parent.parent
    transcript_dir = project_root / "transcripts"
    transcript_dir.mkdir(exist_ok=True)

    transcript_path = None
    session_id = None
    cwd = None

    # ── --stdin 模式：从 stdin JSON 读取 ──
    if "--stdin" in sys.argv:
        try:
            raw_stdin = sys.stdin.buffer.read().decode("utf-8", errors="surrogateescape")
            # 清理可能损坏的 lone surrogate（Windows 中文路径编码问题）
            cleaned = raw_stdin.encode("utf-8", errors="replace").decode("utf-8")
            stdin_data = json.loads(cleaned)
            session_id = stdin_data.get("session_id", "unknown")
            raw_path = stdin_data.get("transcript_path", "")
            cwd = stdin_data.get("cwd", "")
            if raw_path:
                transcript_path = Path(raw_path)
                if not transcript_path.exists():
                    log(f"stdin 指定的 transcript 不存在: {transcript_path}")
                    transcript_path = None
            log(f"stdin 模式: session={session_id[:16] if session_id else '?'}, "
                f"transcript={transcript_path}, cwd={cwd}")
        except Exception as e:
            log(f"stdin 读取失败: {e}")
            sys.exit(1)

        if transcript_path is None:
            log("stdin 未提供有效 transcript_path")
            return
    else:
        # ── 传统模式：命令行参数 ──
        if len(sys.argv) < 2:
            print("Usage: python tools/capture_session.py --stdin")
            print("       python tools/capture_session.py <session_id> [--transcript <path>]")
            sys.exit(1)

        session_id = sys.argv[1]

        if "--transcript" in sys.argv:
            idx = sys.argv.index("--transcript")
            if idx + 1 < len(sys.argv):
                transcript_path = Path(sys.argv[idx + 1])
                if not transcript_path.exists():
                    log(f"--transcript 指定的文件不存在: {transcript_path}")
                    transcript_path = None

        # Fallback：按 session_id 搜索
        if transcript_path is None:
            transcript_path = find_transcript(session_id, project_root)

    if transcript_path is None:
        log(f"未找到 transcript（session={str(session_id)[:16]}）")
        return

    # 生成目标文件名
    today = datetime.now().strftime("%Y-%m-%d")
    dest_name = f"{today}-{session_id[:8]}.jsonl"
    dest_path = transcript_dir / dest_name

    try:
        shutil.copy2(transcript_path, dest_path)
        log(f"存档成功: transcripts/{dest_name} ({dest_path.stat().st_size} bytes)")
    except Exception:
        log(f"复制失败: {transcript_path} → {dest_path}\n{traceback.format_exc()}")
        raise

    # 追加 log.md
    log_path = project_root / "wiki" / "log.md"
    if log_path.exists():
        try:
            log_entry = (f"\n## [{today}] transcript-archived | {dest_name}\n"
                         f"- 来源: Claude Code 自动存档（SessionEnd Hook）\n"
                         f"- 状态: 待 Ingestion\n")
            # 读取最后几行检查是否已有相同记录（避免 Stop 多次触发导致重复）
            existing = log_path.read_text(encoding="utf-8")
            if dest_name not in existing:
                with open(log_path, "a", encoding="utf-8") as f:
                    f.write(log_entry)
        except Exception:
            log(f"log.md 写入失败: {traceback.format_exc()}")

    # 提取项目经验（调用 llm_wiki 的 extract_experiences.py）
    try:
        run_experience_extraction(dest_path, today, project_root, cwd)
    except Exception:
        log(f"经验提取失败: {traceback.format_exc()}")


def run_experience_extraction(jsonl_path: Path, today: str, project_root: Path, cwd: str | None) -> None:
    """调用 llm_wiki 的 extract_experiences.py 提取经验。

    项目名/领域从环境变量读取，fallback 从 cwd 推断。
    输出目录从 LLM_WIKI_OUTPUT_DIR 环境变量读取。
    """
    import subprocess

    # ── 确定 project / domain ──
    project = os.environ.get("LLM_WIKI_PROJECT", "")
    domain = os.environ.get("LLM_WIKI_DOMAIN", "")

    if not project and cwd:
        # 从工作目录名推断项目名
        project = Path(cwd).name
    if not project:
        project = "default"
    if not domain:
        domain = "general"

    # ── 确定输出目录 ──
    output_dir = os.environ.get("LLM_WIKI_OUTPUT_DIR", "")
    if not output_dir:
        # Fallback: 使用 KB_ROOT（llm-wiki-agent 项目）的 raw/sources/experiences
        claude_md = project_root / "CLAUDE.md"
        kb_root = None
        if claude_md.exists():
            import re
            content = claude_md.read_text(encoding="utf-8")
            m = re.search(r"KB_ROOT:\s*(.+)", content)
            if m:
                kb_root = Path(m.group(1).strip())
        if kb_root:
            output_dir = str(kb_root / "raw" / "sources" / "experiences")
        else:
            output_dir = str(project_root / "raw" / "sources" / "experiences")

    # ── 找到 extract_experiences.py ──
    llm_wiki_root = os.environ.get("LLM_WIKI_ROOT", "D:/work/llm_wiki")
    extract_script = Path(llm_wiki_root) / "tools" / "extract_experiences.py"
    if not extract_script.exists():
        log(f"找不到 extract_experiences.py: {extract_script}")
        return

    # ── 调用 extract_experiences.py ──
    log(f"经验提取: project={project}, domain={domain}, output={output_dir}")
    result = subprocess.run(
        [
            sys.executable,
            str(extract_script),
            "--transcript", str(jsonl_path),
            "--project", project,
            "--domain", domain,
            "--output-dir", output_dir,
        ],
        capture_output=True,
        text=True,
        timeout=120,
    )
    if result.returncode == 0:
        log(f"经验提取成功:\n{result.stdout}")
    else:
        log(f"经验提取失败 (exit={result.returncode}):\n{result.stderr}")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(f"未捕获异常:\n{traceback.format_exc()}")
