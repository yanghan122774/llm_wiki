# Schema-Driven Experience Types — Design

**日期:** 2026-06-26
**状态:** 设计完成，待实现
**关联:** [项目经验系统设计](2026-06-15-project-experience-system-design.md)

---

## 一、问题

当前经验提取管线（ingest.ts）中，经验类型和目录映射全部硬编码：

| 硬编码位置 | 内容 |
|-----------|------|
| `EXPERIENCE_TYPES` 常量 | `["bug", "decision", "howto", "agent-error", "pattern", "template"]` |
| `buildGenerationPrompt()` Phase A | 6 种类型的目录路径 + body 结构模板 |
| `detectDanglingWikilinks()` | 6 个硬编码目录 `["wiki/bugs", "wiki/decisions", ...]` |
| Frontmatter type 校验 | `EXPERIENCE_TYPES.join(" \| ")` |
| 输出顺序声明 | `bug → decision → howto → agent-error → pattern → template` |

用户想加自定义经验类型（如 `meeting-notes → wiki/meetings/`），必须改代码 + 重新编译。而 schema.md 已经定义了 Page Types 表，经验提取却不读它。

---

## 二、方案：从 schema.md 动态读取类型定义

### 2.1 schema.md 格式变更

Page Types 表加一个可选列 `Body Sections`：

```markdown
## Page Types

| Type | Directory | Description | Body Sections |
|------|-----------|-------------|---------------|
| bug | wiki/bugs/ | 缺陷记录 | 现象; 根因; 解决方案; 预防 |
| decision | wiki/decisions/ | 技术决策 | 背景; 方案对比; 决策; 后果 |
| howto | wiki/howto/ | 操作指南 | 目的; 前置条件; 步骤; 验证 |
| agent-error | wiki/agent-errors/ | Agent 错误 | 错误行为; 纠正方式; 触发特征; 预防 |
| pattern | wiki/patterns/ | 重复模式 | |
| template | wiki/templates/ | 可复用模板 | 适用范围; 检查清单; 常见坑点 |
```

规则：
- `Type` + `Directory` **必填**，缺一则跳过该行并打 warning
- `Body Sections` **可选**，分号分隔章节名
- `Body Sections` 为空 → LLM 自行发挥章节结构
- 列顺序固定（Type, Directory, Description, Body Sections），不按列名匹配

### 2.2 改动清单

#### 改动 1：新增 `parseExperienceTypesFromSchema()`

**文件:** `src/lib/ingest.ts`

```typescript
interface ExperienceType {
  type: string
  directory: string        // e.g. "wiki/bugs"
  bodySections: string[]   // e.g. ["现象", "根因", "解决方案", "预防"]，空=LLM自行发挥
}

function parseExperienceTypesFromSchema(markdown: string): ExperienceType[]
```

- 复用 `wiki-schema.ts` 中 `pageTypesSectionLines()` 的查找逻辑（找 `## Page Types` 标题）
- 解析表格行，取第 1、2、4 列（跳过第 3 列 Description）
- Type 不合法（非字母开头）→ 跳过 + warning
- Directory 不合法（非 `wiki/` 开头）→ 跳过 + warning
- Body Sections 用分号分隔，trim 每项，过滤空字符串

#### 改动 2：删除 `EXPERIENCE_TYPES` 常量

- 删除第 42-49 行的 `EXPERIENCE_TYPES` 常量定义
- 保留为 fallback 默认值：函数内部如果 schema 无 Page Types 表，回退到当前的 6 种硬编码

#### 改动 3：`buildGenerationPrompt()` 动态生成 Phase A

```
当前 (硬编码):
  "1. **bug** pages → wiki/bugs/<slug>.md"
  "   Structure: ## 现象 → ## 根因 → ## 解决方案 → ## 预防措施"
  ...

改为 (动态):
  for each type in experienceTypes:
    "N. **{type}** pages → {directory}/<slug>.md"
    if bodySections 非空:
      "   Structure: ## {s1} → ## {s2} → ..."
    else:
      "   Structure: 请根据内容自行决定合适的章节结构"
```

输出顺序行也动态生成：`"Phase A FILE blocks ({type1} → {type2} → ...)"`

函数签名新增可选参数 `experienceTypes?: ExperienceType[]`。不传则在函数内自行解析 `schema` 字符串。

#### 改动 4：`detectDanglingWikilinks()` 动态目录

```
当前: const expDirs = ["wiki/bugs", "wiki/decisions", "wiki/howto",
                        "wiki/agent-errors", "wiki/patterns", "wiki/templates"]
改为: 从 experienceTypes 或 schema 中提取 directory 字段
```

函数签名新增可选参数，或内部自行解析。

#### 改动 5：更新测试

**文件:** `src/lib/ingest.prompt.test.ts`

- `EXPERIENCE_TYPES` 测试改为测试 `parseExperienceTypesFromSchema()`
- 经验 prompt 测试确保动态生成正确

### 2.3 不改的部分

| 位置 | 原因 |
|------|------|
| `isExperienceSource()` | 只检查路径中的 `/experiences/` 或 `/sessions/`，与类型列表无关 |
| `validateWikiPageRouting()` | 已从 schema.md 动态读取 Page Types 表（只读前 2 列），无需改 |
| type-specific frontmatter 规则（bug 的 status、decision 的 superseded_by） | 保持硬编码。自定义类型无特殊 status 约束，LLM 只需写 `created`/`updated`/`tags` 等通用字段 |

---

## 三、向后兼容

| 场景 | 处理 |
|------|------|
| schema.md 没有 Page Types 表 | 回退到当前 6 种硬编码类型 |
| 表缺少 Body Sections 列（只有 2-3 列） | 该列所有行为空，LLM 自行发挥 |
| 表有 Body Sections 列但某行为空 | 该行 LLM 自行发挥 |
| Type 或 Directory 缺失/非法 | 跳过该行，console.warn |

---

## 四、风险

1. **schema.md 格式依赖** — 表结构变化（列顺序改变、标题改名）会导致解析失败。缓解：回退到硬编码默认值。
2. **LLM 判断准确度** — 自定义类型没有 body 结构模板时，LLM 分类可能不准。缓解：强烈建议用户在 schema 中填写 Body Sections。
3. **测试覆盖** — 现有测试依赖 `EXPERIENCE_TYPES` 常量，需同步更新。

---

## 五、验证

1. 用现有 6 种类型的 schema.md 测试 → 生成的 prompt 与当前一致
2. 在 schema.md 加一个自定义类型（如 `meeting-notes → wiki/meetings/`）→ prompt 包含该类型
3. `detectDanglingWikilinks` 检查 `wiki/meetings/` 目录
4. 删除 schema.md → 回退到硬编码默认值
5. Body Sections 为空 → prompt 写 "请根据内容自行决定合适的章节结构"
