# CLAUDE.md — llm_wiki 项目

## 项目概述

Tauri v2 + React 19 + TypeScript 桌面应用。个人知识库 + 项目经验积累系统。
完整设计文档：`docs/superpowers/specs/2026-06-15-project-experience-system-design.md`

## 经验系统触发规则

### 会话启动：项目情境加载

启动时，按顺序执行以下步骤组装项目情境：

1. 读取 wiki/purpose.md — 获取项目名、技术栈、当前关注点
2. 读取 wiki/log.md 最近 5 条 — 了解上次会话做了什么
3. 列出 wiki/bugs/，逐个读 frontmatter，筛选 status=unresolved — 待解决清单
4. 列出 wiki/decisions/，逐个读 frontmatter，筛选 status=proposed — 待定清单
5. (可选) git branch + git status — 交叉比对当前上下文
6. 按格式输出情境摘要

📋 **项目情境加载完成**

**项目:** <项目名> (<技术栈>)
**阶段:** <当前关注点>
**上次会话:** YYYY-MM-DD — <最近 log>

⚠️ **待解决:** N bugs / M decisions 待定
- [[bug-slug]] — 描述 (日期)
- [[decision-slug]] — 描述 (日期)

📌 **相关经验:** (基于 git 上下文自动搜索)

### 自动触发规则

遇到以下情况时，**必须**主动通过 MCP 搜索知识库：

1. **编译/运行时错误** — 错误信息包含 "error"、"failed"、"panic"、"cannot"、"undefined is not"、"ENOENT"、"ECONNREFUSED" 等
2. **配置文件问题** — 配置不生效、格式错误
3. **环境依赖问题** — 找不到工具、版本不兼容
4. **重复性工作** — 用户说"上次怎么做的"、"又遇到这个"

**搜索步骤：**
1. 提取错误关键词
2. 调用 `llm_wiki_search`
3. 有匹配结果 → 告知用户："⚠️ 知识库有相关经验：[[PageName]] — 摘要"
4. 无匹配 → 继续正常排错流程
5. 问题解决后 → 确认是否产生新经验（如有，标记待 SessionEnd 提取）

### xp 命令 — 手动提炼经验

触发词：`xp` 或 "提炼经验" 或 "记录这个坑"

动作：
1. 获取当前会话的 transcript（最近的对话）
2. 用户描述要记录的内容（可选：指定类型 bug/decision/pattern）
3. 生成结构化经验页面 → 写入 wiki/ 对应目录
4. 更新 wiki/index.md
5. 追加 wiki/log.md

目的：当 extract_experiences.py 漏掉、或用户觉得某件事特别值得记录时的手动补充。

## 技术栈

- **前端**: React 19 + TypeScript 5.7 + Vite 8 + Tailwind CSS 4
- **后端**: Tauri 2 (Rust) — 49 个 Tauri commands
- **搜索**: BM25 关键字 + 向量 ANN (LanceDB) + RRF 融合
- **MCP Server**: Node.js, `@modelcontextprotocol/sdk`, 8 个工具
- **核心管线**: `src/lib/ingest.ts`（两阶段 LLM: 分析→生成）, `src/lib/page-merge.ts`（三层合并保护）, `src/lib/frontmatter.ts`（YAML 解析）

## 关键文件

| 文件 | 职责 |
|------|------|
| `src-tauri/src/commands/project.rs` | 项目创建 / schema 模板 |
| `src-tauri/src/commands/search.rs` | 搜索（BM25 + 向量 + RRF） |
| `src/lib/ingest.ts` | 自动摄取核心管线 |
| `src/lib/page-merge.ts` | 页面合并保护 |
| `src/lib/wiki-page-types.ts` | 类型系统中枢 |
| `src/lib/frontmatter.ts` | YAML frontmatter 解析 |
| `mcp-server/src/index.ts` | MCP 服务器 |
| `tools/extract_experiences.py` | 经验提取脚本 |
