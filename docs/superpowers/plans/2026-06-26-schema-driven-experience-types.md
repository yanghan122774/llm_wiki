# Schema-Driven Experience Types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate hardcoded experience type lists in ingest.ts, instead reading them dynamically from schema.md's Page Types table.

**Architecture:** Add `parseExperienceTypesFromSchema()` to extract Type/Directory/BodySections from schema.md, delete the `EXPERIENCE_TYPES` constant, and thread the parsed types through `buildGenerationPrompt()` (dynamic Phase A output) and `detectDanglingWikilinks()` (dynamic directory list). Fallback to current 6 hardcoded types when schema.md has no Page Types table.

**Tech Stack:** TypeScript, Vitest

**Spec:** [2026-06-26-schema-driven-experience-types-design.md](../specs/2026-06-26-schema-driven-experience-types-design.md)

## Global Constraints

- schema.md Page Types table columns: Type, Directory, Description, Body Sections (4th column optional)
- Body Sections column uses semicolon delimiter
- Fallback to 6 hardcoded types when schema has no Page Types table
- Type-specific frontmatter rules (bug status, decision superseded_by) stay hardcoded
- `isExperienceSource()` and `validateWikiPageRouting()` unchanged

---

### Task 1: Export `pageTypesSectionLines` from wiki-schema.ts

**Files:**
- Modify: `src/lib/wiki-schema.ts:47`

**Interfaces:**
- Produces: `export function pageTypesSectionLines(markdown: string): string[]` — extracts lines under `## Page Types` heading

- [ ] **Step 1: Add `export` keyword to `pageTypesSectionLines`**

In `src/lib/wiki-schema.ts`, line 47, change:
```typescript
function pageTypesSectionLines(markdown: string): string[] {
```
to:
```typescript
export function pageTypesSectionLines(markdown: string): string[] {
```

- [ ] **Step 2: Verify it compiles**

Run: `cd d:/work/llm_wiki && npx tsc --noEmit src/lib/wiki-schema.ts 2>&1 | head -5`
Expected: no errors from wiki-schema.ts

- [ ] **Step 3: Commit**

```bash
git add src/lib/wiki-schema.ts
git commit -m "refactor: export pageTypesSectionLines for reuse in ingest.ts"
```

---

### Task 2: Add `ExperienceType` interface and `parseExperienceTypesFromSchema()`

**Files:**
- Modify: `src/lib/ingest.ts` (insert after line 49, before `isExperienceSource`)

**Interfaces:**
- Consumes: `pageTypesSectionLines` from `@/lib/wiki-schema`
- Produces:
  - `interface ExperienceType { type: string; directory: string; bodySections: string[] }`
  - `const DEFAULT_EXPERIENCE_TYPES: ExperienceType[]` — 6-item fallback
  - `function parseExperienceTypesFromSchema(markdown: string): ExperienceType[]`

- [ ] **Step 1: Add the import, interface, default, and function**

Insert after line 39 (`import { GENERATION_WIKI_TYPES } from "@/lib/wiki-page-types"`) in `src/lib/ingest.ts`:

```typescript
import { pageTypesSectionLines } from "@/lib/wiki-schema"
```

Insert after the `EXPERIENCE_TYPES` block (lines 42-49), replacing it:

```typescript
/** Experience type descriptor parsed from schema.md Page Types table. */
export interface ExperienceType {
  type: string
  /** Wiki directory (no trailing slash), e.g. "wiki/bugs" */
  directory: string
  /**
   * Section headings for the page body, in order.
   * Empty array means the LLM should decide the structure itself.
   */
  bodySections: string[]
}

/** Fallback used when schema.md has no Page Types table. */
export const DEFAULT_EXPERIENCE_TYPES: ExperienceType[] = [
  { type: "bug",         directory: "wiki/bugs",         bodySections: ["现象", "根因", "解决方案", "预防"] },
  { type: "decision",    directory: "wiki/decisions",    bodySections: ["背景", "方案对比", "决策", "后果"] },
  { type: "howto",       directory: "wiki/howto",        bodySections: ["目的", "前置条件", "步骤", "验证"] },
  { type: "agent-error", directory: "wiki/agent-errors", bodySections: ["错误行为", "纠正方式", "触发特征", "预防"] },
  { type: "pattern",     directory: "wiki/patterns",     bodySections: [] },  // LLM自行发挥—需要≥2条证据
  { type: "template",    directory: "wiki/templates",    bodySections: ["适用范围", "检查清单", "常见坑点"] },
]

/**
 * Parse experience types from a schema.md markdown string.
 *
 * Reads the "## Page Types" table, extracting Type, Directory, and
 * optional Body Sections (4th column, semicolon-delimited).
 *
 * Returns DEFAULT_EXPERIENCE_TYPES when the schema has no Page Types
 * section or no valid rows are found.
 */
export function parseExperienceTypesFromSchema(markdown: string): ExperienceType[] {
  if (!markdown || !markdown.trim()) return DEFAULT_EXPERIENCE_TYPES

  const lines = pageTypesSectionLines(markdown)
  if (lines.length === 0) return DEFAULT_EXPERIENCE_TYPES

  // Detect header row to find the Body Sections column index.
  // We look for the first table row that looks like a header separator
  // (|---|---|...) or a header with column names.
  let bodySectionsCol = -1 // -1 means "not present"
  const result: ExperienceType[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith("|")) continue

    // Skip separator lines like |---|...---|---|
    if (/^\|[\s\-:|]+\|$/.test(trimmed)) continue

    const cells = trimmed
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim())

    // Detect header row
    if (cells.some((c) => /^body\s*sections?$/i.test(c))) {
      bodySectionsCol = cells.findIndex((c) => /^body\s*sections?$/i.test(c))
      continue
    }

    // Skip if we haven't passed the header yet and cells look like headers
    if (bodySectionsCol === -1 && cells.some((c) => /^(type|directory|description)$/i.test(c))) {
      // Check if this row has a "Body Sections" column
      const bsIdx = cells.findIndex((c) => /^body\s*sections?$/i.test(c))
      if (bsIdx >= 0) bodySectionsCol = bsIdx
      continue
    }

    if (cells.length < 2) continue

    const type = cells[0]
    const dir = cells[1]

    // Validate type and directory
    if (!/^[a-z][a-z0-9_-]*$/i.test(type)) {
      console.warn(`[ingest] schema Page Types: skipping invalid type "${type}"`)
      continue
    }
    if (dir !== "wiki" && !dir.startsWith("wiki/")) {
      console.warn(`[ingest] schema Page Types: skipping invalid directory "${dir}" for type "${type}"`)
      continue
    }

    // Parse optional Body Sections (4th column if present)
    let bodySections: string[] = []
    if (bodySectionsCol >= 0 && cells.length > bodySectionsCol) {
      const raw = cells[bodySectionsCol]
      if (raw) {
        bodySections = raw
          .split(/[;；]/)  // support both ASCII and fullwidth semicolons
          .map((s) => s.trim())
          .filter(Boolean)
      }
    }

    result.push({
      type,
      directory: dir.replace(/\/+$/, ""), // strip trailing slash
      bodySections,
    })
  }

  return result.length > 0 ? result : DEFAULT_EXPERIENCE_TYPES
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd d:/work/llm_wiki && npx tsc --noEmit --project tsconfig.json 2>&1 | grep -i "ingest.ts" | head -10`
Expected: no errors from ingest.ts

- [ ] **Step 3: Commit**

```bash
git add src/lib/ingest.ts
git commit -m "feat: add parseExperienceTypesFromSchema() with DEFAULT_EXPERIENCE_TYPES fallback"
```

---

### Task 3: Update `buildGenerationPrompt()` to use dynamic types

**Files:**
- Modify: `src/lib/ingest.ts:1958-2063` (function signature + Phase A content)

**Interfaces:**
- Consumes: `ExperienceType` interface, `parseExperienceTypesFromSchema` from Task 2
- Produces: Updated `buildGenerationPrompt()` with optional `experienceTypes` parameter, dynamic Phase A generation

- [ ] **Step 1: Read the current Phase A section to confirm exact text**

Run: `sed -n '2005,2063p' src/lib/ingest.ts`
(Confirm lines 2005-2063 match expectations)

- [ ] **Step 2: Add `experienceTypes` parameter and parse inside function**

Change the function signature at line 1958 from:

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
  const sourceBaseName = sourceFileName.replace(/\.[^.]+$/, "")
  const summaryPath = sourceSummaryPath ?? `wiki/sources/${sourceBaseName}.md`
  const today = currentWikiDate()
  console.error(`[GEN-v8] buildGenerationPrompt called — isExperience=${isExperience} sourceFileName="${sourceFileName}"`)
```

to:

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
  experienceTypes?: ExperienceType[],
): string {
  // Resolve experience types: explicit arg > parse from schema > default
  const resolvedExpTypes =
    experienceTypes ??
    (isExperience ? parseExperienceTypesFromSchema(schema) : undefined)
  const expTypeNames = resolvedExpTypes?.map((t) => t.type) ?? []
  const sourceBaseName = sourceFileName.replace(/\.[^.]+$/, "")
  const summaryPath = sourceSummaryPath ?? `wiki/sources/${sourceBaseName}.md`
  const today = currentWikiDate()
  console.error(`[GEN-v8] buildGenerationPrompt called — isExperience=${isExperience} sourceFileName="${sourceFileName}"`)
```

- [ ] **Step 3: Replace hardcoded Phase A type entries with dynamic generation**

Replace lines 2007-2021 (from `"Generate ONE FILE block PER experience found..."` through the 6 hardcoded type entries) with:

Use this Edit to replace the block. Old string (lines 2007-2021):

```
          "Generate ONE FILE block PER experience found. Every distinct bug, decision,",
          "how-to, agent-error, pattern, or template gets its own FILE block.",
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
```

New string:

```
          `Generate ONE FILE block PER experience found. Every distinct ${expTypeNames.join(", ")} gets its own FILE block.`,
          "",
          ...(resolvedExpTypes && resolvedExpTypes.length > 0
            ? resolvedExpTypes.flatMap((et, i) => {
                const header = `${i + 1}. **${et.type}** pages → ${et.directory}/<slug>.md`
                if (et.bodySections.length > 0) {
                  const structure = et.bodySections.map((s) => `## ${s}`).join(" → ")
                  return [
                    header,
                    `   Structure: ${structure}`,
                  ]
                }
                return [
                  header,
                  "   Structure: 请根据内容自行决定合适的章节结构",
                ]
              })
            : [
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
              ]
          ),
```

- [ ] **Step 4: Replace hardcoded output order line**

Replace line 2055:

```
          "1. Phase A FILE blocks (bug → decision → howto → agent-error → pattern → template)",
```

with:

```
          `1. Phase A FILE blocks (${expTypeNames.join(" → ")})`,
```

- [ ] **Step 5: Replace `EXPERIENCE_TYPES.join` in frontmatter type rule**

Replace line 2102:

```
      ? `  • type     — MUST be one of: ${EXPERIENCE_TYPES.join(" | ")}. Using "source", "entity", "concept", or any other non-experience type WILL be rejected.`
```

with:

```
      ? `  • type     — MUST be one of: ${expTypeNames.join(" | ")}. Using "source", "entity", "concept", or any other non-experience type WILL be rejected.`
```

- [ ] **Step 6: Verify it compiles**

Run: `cd d:/work/llm_wiki && npx tsc --noEmit --project tsconfig.json 2>&1 | grep -i "ingest" | head -10`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/lib/ingest.ts
git commit -m "refactor: dynamic experience type generation in buildGenerationPrompt()"
```

---

### Task 4: Update `detectDanglingWikilinks()` to use dynamic directories

**Files:**
- Modify: `src/lib/ingest.ts:1323-1393`

**Interfaces:**
- Consumes: `parseExperienceTypesFromSchema` from Task 2
- Produces: `detectDanglingWikilinks()` with dynamic expDirs

- [ ] **Step 1: Add `schema` parameter and resolve dynamically**

Change function signature at line 1323 from:

```typescript
async function detectDanglingWikilinks(
  projectPath: string,
  writtenPaths: string[],
): Promise<string[]> {
```

to:

```typescript
async function detectDanglingWikilinks(
  projectPath: string,
  writtenPaths: string[],
  schema?: string,
): Promise<string[]> {
```

Add after `const pp = normalizePath(projectPath)` (line 1328):

```typescript
  // Resolve experience directories from schema (with hardcoded fallback)
  const expDirs = schema
    ? parseExperienceTypesFromSchema(schema).map((et) => et.directory)
    : DEFAULT_EXPERIENCE_TYPES.map((et) => et.directory)
```

- [ ] **Step 2: Remove hardcoded `expDirs` array**

Delete lines 1353-1361:

```typescript
  // Experience page directories to check against each slug.
  const expDirs = [
    "wiki/bugs",
    "wiki/decisions",
    "wiki/howto",
    "wiki/agent-errors",
    "wiki/patterns",
    "wiki/templates",
  ]
```

- [ ] **Step 3: Pass `schema` from the call site**

Find the call site near line 1004 in `autoIngestImpl`:

```typescript
const danglingWarnings = await detectDanglingWikilinks(pp, writtenPaths)
```

Change to:

```typescript
const danglingWarnings = await detectDanglingWikilinks(pp, writtenPaths, schema)
```

The `schema` variable is already in scope (it's declared at line 581).

- [ ] **Step 4: Verify it compiles**

Run: `cd d:/work/llm_wiki && npx tsc --noEmit --project tsconfig.json 2>&1 | grep -i "ingest" | head -10`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/lib/ingest.ts
git commit -m "refactor: dynamic experience directories in detectDanglingWikilinks()"
```

---

### Task 5: Delete `EXPERIENCE_TYPES` constant and update exports

**Files:**
- Modify: `src/lib/ingest.ts:42-49`

**Interfaces:**
- Consumes: `DEFAULT_EXPERIENCE_TYPES` from Task 2
- Produces: Removes `EXPERIENCE_TYPES`, exports `DEFAULT_EXPERIENCE_TYPES` and `parseExperienceTypesFromSchema` instead

- [ ] **Step 1: Delete `EXPERIENCE_TYPES` constant**

Delete lines 42-49 in `src/lib/ingest.ts`:

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
```

(The `DEFAULT_EXPERIENCE_TYPES` added in Task 2 already replaces this.)

- [ ] **Step 2: Verify nothing else references `EXPERIENCE_TYPES`**

Run: `cd d:/work/llm_wiki && npx tsc --noEmit --project tsconfig.json 2>&1 | grep "EXPERIENCE_TYPES"`
Expected: no output (nothing else references it — the usage at line 2102 was already replaced in Task 3, and the test import will be updated in Task 6)

- [ ] **Step 3: Commit**

```bash
git add src/lib/ingest.ts
git commit -m "refactor: remove EXPERIENCE_TYPES constant, replaced by DEFAULT_EXPERIENCE_TYPES"
```

---

### Task 6: Update tests

**Files:**
- Modify: `src/lib/ingest.prompt.test.ts` (import, EXPERIENCE_TYPES test, experience prompt tests)

**Interfaces:**
- Consumes: `parseExperienceTypesFromSchema`, `DEFAULT_EXPERIENCE_TYPES`, `ExperienceType` from Task 2 & 5

- [ ] **Step 1: Update imports**

Replace line 11:
```typescript
  EXPERIENCE_TYPES,
```
with:
```typescript
  parseExperienceTypesFromSchema,
  DEFAULT_EXPERIENCE_TYPES,
```
And add the type import:
```typescript
  type ExperienceType,
```
(Add to the existing import from `"./ingest"`)

- [ ] **Step 2: Replace EXPERIENCE_TYPES test with DEFAULT_EXPERIENCE_TYPES test**

Replace lines 174-185:

```typescript
describe("EXPERIENCE_TYPES", () => {
  it("contains exactly 6 experience types", () => {
    expect(EXPERIENCE_TYPES).toEqual([
      "bug",
      "decision",
      "howto",
      "agent-error",
      "pattern",
      "template",
    ])
  })
})
```

with:

```typescript
describe("DEFAULT_EXPERIENCE_TYPES", () => {
  it("contains exactly 6 experience types", () => {
    expect(DEFAULT_EXPERIENCE_TYPES).toHaveLength(6)
    expect(DEFAULT_EXPERIENCE_TYPES.map((t) => t.type)).toEqual([
      "bug",
      "decision",
      "howto",
      "agent-error",
      "pattern",
      "template",
    ])
  })

  it("every type has a wiki/ directory", () => {
    for (const et of DEFAULT_EXPERIENCE_TYPES) {
      expect(et.directory).toMatch(/^wiki\//)
    }
  })
})

describe("parseExperienceTypesFromSchema", () => {
  it("returns DEFAULT_EXPERIENCE_TYPES for empty input", () => {
    expect(parseExperienceTypesFromSchema("")).toEqual(DEFAULT_EXPERIENCE_TYPES)
    expect(parseExperienceTypesFromSchema("some random text")).toEqual(DEFAULT_EXPERIENCE_TYPES)
  })

  it("parses Type and Directory from a Page Types table", () => {
    const schema = [
      "## Page Types",
      "",
      "| Type | Directory | Description |",
      "|------|-----------|-------------|",
      "| bug | wiki/bugs/ | 缺陷记录 |",
      "| meeting-notes | wiki/meetings/ | 会议记录 |",
    ].join("\n")

    const result = parseExperienceTypesFromSchema(schema)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ type: "bug", directory: "wiki/bugs", bodySections: [] })
    expect(result[1]).toEqual({ type: "meeting-notes", directory: "wiki/meetings", bodySections: [] })
  })

  it("parses Body Sections when the column is present", () => {
    const schema = [
      "## Page Types",
      "",
      "| Type | Directory | Description | Body Sections |",
      "|------|-----------|-------------|---------------|",
      "| bug | wiki/bugs/ | 缺陷 | 现象; 根因; 解决方案 |",
      "| meeting-notes | wiki/meetings/ | 会议 | |",
    ].join("\n")

    const result = parseExperienceTypesFromSchema(schema)
    expect(result).toHaveLength(2)
    expect(result[0].bodySections).toEqual(["现象", "根因", "解决方案"])
    expect(result[1].bodySections).toEqual([])
  })

  it("strips trailing slashes from directories", () => {
    const schema = [
      "## Page Types",
      "",
      "| Type | Directory |",
      "|------|-----------|",
      "| bug | wiki/bugs/ |",
    ].join("\n")

    const result = parseExperienceTypesFromSchema(schema)
    expect(result[0].directory).toBe("wiki/bugs")
  })

  it("skips rows with invalid type or directory", () => {
    const schema = [
      "## Page Types",
      "",
      "| Type | Directory |",
      "|------|-----------|",
      "| 123bad | wiki/stuff/ |",
      "| ok | not-wiki/ |",
      "| good | wiki/good/ |",
    ].join("\n")

    const result = parseExperienceTypesFromSchema(schema)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe("good")
  })
})
```

- [ ] **Step 3: Update experience prompt test to use dynamic check**

The test at line 302 checks for hardcoded paths. It should still pass because `buildGenerationPrompt` with empty schema (`""`) will fallback to `DEFAULT_EXPERIENCE_TYPES` via `parseExperienceTypesFromSchema`.

But the test at line 319 specifically checks `EXPERIENCE_TYPES.join(" | ")` output. With the dynamic approach and empty schema, `expTypeNames` will resolve from the fallback, so the prompt should still contain `"MUST be one of: bug | decision | howto | agent-error | pattern | template"`. This test should still pass as-is.

- [ ] **Step 4: Add a test for dynamic types in prompt**

Add a new test after the existing experience prompt tests (after line 339):

```typescript
  it("generates dynamic type entries from schema Page Types table", () => {
    const schema = [
      "## Page Types",
      "",
      "| Type | Directory | Description | Body Sections |",
      "|------|-----------|-------------|---------------|",
      "| bug | wiki/bugs/ | 缺陷 | 现象; 根因; 解决方案 |",
      "| meeting-notes | wiki/meetings/ | 会议 | 议题; 结论; 待办 |",
    ].join("\n")

    const customTypes = parseExperienceTypesFromSchema(schema)
    const prompt = buildGenerationPrompt(
      schema, "", "", "x.md", undefined, "", undefined, true, expMeta, customTypes,
    )
    // Should contain bug (with body sections)
    expect(prompt).toContain("**bug** pages → wiki/bugs/<slug>.md")
    expect(prompt).toContain("## 现象 → ## 根因 → ## 解决方案")
    // Should contain custom type (with body sections)
    expect(prompt).toContain("**meeting-notes** pages → wiki/meetings/<slug>.md")
    expect(prompt).toContain("## 议题 → ## 结论 → ## 待办")
    // Output order should include both
    expect(prompt).toContain("Phase A FILE blocks (bug → meeting-notes)")
    // Type restriction should include both
    expect(prompt).toContain("MUST be one of: bug | meeting-notes")
  })

  it("prompts LLM to decide structure when bodySections is empty", () => {
    const schema = [
      "## Page Types",
      "",
      "| Type | Directory |",
      "|------|-----------|",
      "| pattern | wiki/patterns/ |",
    ].join("\n")

    const customTypes = parseExperienceTypesFromSchema(schema)
    const prompt = buildGenerationPrompt(
      schema, "", "", "x.md", undefined, "", undefined, true, expMeta, customTypes,
    )
    expect(prompt).toContain("请根据内容自行决定合适的章节结构")
  })
```

- [ ] **Step 5: Run tests**

Run: `cd d:/work/llm_wiki && npx vitest run src/lib/ingest.prompt.test.ts`
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/lib/ingest.prompt.test.ts
git commit -m "test: update tests for schema-driven experience types"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run full test suite**

Run: `cd d:/work/llm_wiki && npx vitest run`
Expected: all tests pass

- [ ] **Step 2: Type-check the whole project**

Run: `cd d:/work/llm_wiki && npx tsc --noEmit --project tsconfig.json`
Expected: no errors

- [ ] **Step 3: Verify no remaining references to `EXPERIENCE_TYPES`**

Run: `cd d:/work/llm_wiki && grep -rn "EXPERIENCE_TYPES" src/`
Expected: no output (the constant is fully removed)

- [ ] **Step 4: Commit if any cleanup needed, or mark done**

```bash
git status
```
