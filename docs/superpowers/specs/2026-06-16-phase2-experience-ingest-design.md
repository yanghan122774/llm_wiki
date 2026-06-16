# Phase 2: 经验提取 Ingest 管线 — 设计文档

**日期:** 2026-06-16
**状态:** 已实现
**背景:** 在 Phase 1（schema 模板扩展 + 触发规则）基础上，让 Ingest 管线自动检测经验源文件并产出结构化经验页面。

---

## 一、核心设计决策

### 1.1 为什么不另起炉灶

Phase 2 最初尝试了一个独立的 `buildExperienceGenerationPrompt()` 函数（v1→v7），但 DeepSeek LLM 持续无视它——总是回退到 `type: source` 输出。

**根因:** DeepSeek 对熟悉的 prompt 结构顺从，对陌生的 prompt 结构无视。通用 `buildGenerationPrompt` 被调用了无数次，LLM 已形成稳定的行为惯性。独立的经验 prompt 虽然尽力模仿了通用结构，但对 LLM 来说仍是"陌生人"。

**决策:** 不创建独立的经验 prompt。在通用 `buildGenerationPrompt()` 内部通过 `isExperience` 参数**只切换 "What to generate" 段落**。其他所有内容（role、schema 规则、frontmatter 格式、FILE 块模板、Output Format）完全不变。LLM 看到的是同一个已学会遵循的 prompt。

### 1.2 三层防护架构

```
检测(isExperienceSource) → 引导(prompt "What to generate" 切换) → 约束(schema + validateWikiPageRouting 兜底)
```

| 层 | 机制 | 作用 |
|----|------|------|
| 检测 | `isExperienceSource(sp)` — 看路径中是否含 `experiences/` 或 `sessions/` | 判断是什么类型的来源 |
| 引导 | `buildGenerationPrompt` 的 "What to generate" 根据 `isExperience` 切换 | 消除指令冲突，事前引导 LLM |
| 约束 | Schema 只定义经验类型 + `validateWikiPageRouting` 拒绝未知 type | 兜底校验，LLM 出错也不写入错误页面 |

---

## 二、改动文件

| 文件 | 改动 | 说明 |
|------|------|------|
| `src/lib/ingest.ts` | 修改（核心） | 加 3 个工具函数 + 修改 `buildAnalysisPrompt` + 修改 `buildGenerationPrompt` + 修改 `autoIngestImpl` |
| `tools/extract_experiences.py` | 重写 | 去掉 LLM 调用，纯文本 transcript→markdown |
| `src/lib/wiki-schema.ts` | 修改 | `validateWikiPageRouting` 拒绝 schema 中不存在的 type |
| `src/lib/templates.ts` | 修改 | 新增 `experienceTemplate`（6 种经验类型） |

---

## 三、关键实现细节

### 3.1 `isExperienceSource()` — 路径检测

```typescript
export function isExperienceSource(sourcePath: string): boolean {
  const normalized = sourcePath.replace(/\\/g, "/").toLowerCase()
  return (
    normalized.includes("/experiences/") ||
    normalized.includes("/sessions/") ||
    normalized.startsWith("experiences/") ||
    normalized.startsWith("sessions/")
  )
}
```

匹配 4 种路径模式：`raw/sources/experiences/xxx.md`、`raw/sessions/xxx.md`、以及不以 `raw/sources/` 为前缀的相对路径。

### 3.2 `buildGenerationPrompt()` — 条件切换

函数签名新增两个参数（均有默认值，向后兼容）：

```typescript
isExperience: boolean = false,
experienceMeta?: { project: string; domain: string }
```

切换的 4 个位置：

1. **"What to generate" 段落**: 经验模式下列出 6 种经验类型 + body 结构（现象→根因→解决→预防），不生成 source summary/index/log
2. **Type 可选值**: 经验模式限制为 `EXPERIENCE_TYPES`，通用模式保持 `GENERATION_WIKI_TYPES`
3. **额外 frontmatter 字段**: 经验模式要求 `project` + `domain`
4. **额外规则**: 经验模式下添加 page body 结构要求

### 3.3 `validateWikiPageRouting()` — 兜底约束

新增逻辑：如果页面的 `type` 不在 schema routing 中 → 直接拒绝。

**场景:** 经验项目的 `schema.md` 只定义 6 种经验类型。即使 LLM 无视 prompt 产出 `type: source`，这个校验也会拦截并删除该页面。

### 3.4 `extract_experiences.py` — 职责简化

**之前:** 自己调 LLM 提取经验 → 写 Markdown（重复造轮子，与 Ingest 管线脱节）

**现在:** transcript JSONL → 过滤噪音 → 提取文本 → 写带 project/domain frontmatter 的 Markdown → 让 Ingest 管线自动处理

---

## 四、数据类型

### 4.1 经验类型（6 种）

| Type | Directory | 页面结构 |
|------|-----------|----------|
| bug | wiki/bugs/ | 现象 → 根因 → 解决方案 → 预防措施 |
| decision | wiki/decisions/ | 背景 → 考虑的方案 → 决策 → 后果 |
| howto | wiki/howto/ | 目的 → 前置条件 → 步骤 → 验证 |
| agent-error | wiki/agent-errors/ | 错误行为 → 纠正方式 → 触发特征 → 预防 |
| pattern | wiki/patterns/ | 概述 → 证据 → 根因模式 → 预防策略 |
| template | wiki/templates/ | 适用范围 → 检查清单 → 常见坑点 |

### 4.2 Frontmatter 扩展字段

```yaml
project: "<来源项目名>"
domain: "<技术领域>"
```

---

## 五、与原设计文档的差异

原设计文档（`2026-06-15-project-experience-system-design.md`）5.1 节描述了一个独立的 `experience-prompt.ts`（约 150 行），与通用 prompt 完全分离。

本实现放弃了该方案，改为在通用 prompt 内部条件切换。原因：
- DeepSeek 模型对独立的新 prompt 不服从
- 合并方案改动更小、维护更简单
- 不需要维护两套 prompt 的对齐关系
