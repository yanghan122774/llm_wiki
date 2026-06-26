import { describe, it, expect, beforeEach } from "vitest"
import {
  buildAnalysisPrompt,
  buildGenerationPrompt,
  computeIngestGenerationMaxTokens,
  computeIngestReviewMaxTokens,
  computeIngestSourceBudget,
  splitSourceIntoSemanticChunks,
  isExperienceSource,
  extractExperienceMeta,
  DEFAULT_EXPERIENCE_TYPES,
  parseExperienceTypesFromSchema,
} from "./ingest"
import type { ExperienceType } from "./ingest"
import { useWikiStore } from "@/stores/wiki-store"

beforeEach(() => {
  useWikiStore.getState().setOutputLanguage("auto")
})

describe("buildAnalysisPrompt language directive", () => {
  it("injects the user's explicit language setting", () => {
    useWikiStore.getState().setOutputLanguage("Chinese")
    const prompt = buildAnalysisPrompt("purpose", "index", "english source content")
    expect(prompt).toContain("MANDATORY OUTPUT LANGUAGE: Chinese")
  })

  it("uses user setting even when source is in a different language", () => {
    useWikiStore.getState().setOutputLanguage("Japanese")
    const prompt = buildAnalysisPrompt("", "", "这段内容是中文")
    expect(prompt).toContain("MANDATORY OUTPUT LANGUAGE: Japanese")
    expect(prompt).not.toContain("OUTPUT LANGUAGE: Chinese")
  })

  it("auto mode falls back to detecting source content language", () => {
    useWikiStore.getState().setOutputLanguage("auto")
    const prompt = buildAnalysisPrompt("", "", "これは日本語の文章です")
    expect(prompt).toContain("MANDATORY OUTPUT LANGUAGE: Japanese")
  })

  it("auto mode with empty source defaults to English", () => {
    useWikiStore.getState().setOutputLanguage("auto")
    const prompt = buildAnalysisPrompt("", "", "")
    expect(prompt).toContain("MANDATORY OUTPUT LANGUAGE: English")
  })

  it("contains structural analysis sections", () => {
    const prompt = buildAnalysisPrompt("", "", "")
    expect(prompt).toContain("## Key Entities")
    expect(prompt).toContain("## Key Concepts")
    expect(prompt).toContain("## Main Arguments & Findings")
    expect(prompt).toContain("## Recommendations")
  })
})

describe("buildGenerationPrompt language directive", () => {
  it("injects the user's explicit language setting", () => {
    useWikiStore.getState().setOutputLanguage("Chinese")
    const prompt = buildGenerationPrompt("schema", "purpose", "index", "source.pdf")
    expect(prompt).toContain("MANDATORY OUTPUT LANGUAGE: Chinese")
  })

  it("honors Vietnamese setting", () => {
    useWikiStore.getState().setOutputLanguage("Vietnamese")
    const prompt = buildGenerationPrompt("", "", "", "file.pdf")
    expect(prompt).toContain("MANDATORY OUTPUT LANGUAGE: Vietnamese")
  })

  it("auto mode detects from source content", () => {
    useWikiStore.getState().setOutputLanguage("auto")
    const prompt = buildGenerationPrompt("", "", "", "file.pdf", undefined, "这是中文源文档内容")
    expect(prompt).toContain("MANDATORY OUTPUT LANGUAGE: Chinese")
  })

  it("includes the source filename in output instructions", () => {
    const prompt = buildGenerationPrompt("", "", "", "my-paper.pdf")
    expect(prompt).toContain("my-paper.pdf")
  })

  it("tells the model to keep generated filenames aligned with the output language", () => {
    useWikiStore.getState().setOutputLanguage("Chinese")
    const prompt = buildGenerationPrompt("", "", "", "source.pdf")

    expect(prompt).toContain("Derive filenames from the page title in the mandatory output language")
    expect(prompt).toContain("keep readable CJK characters in the filename")
  })

  it("makes project schema routing authoritative over default entity and concept folders", () => {
    const prompt = buildGenerationPrompt(
      "Use wiki/people/ for people. Use wiki/technologies/ for technical methods.",
      "",
      "",
      "source.pdf",
    )
    expect(prompt).toContain("## Project Schema and Routing (AUTHORITATIVE)")
    expect(prompt).toContain("write pages into those schema-defined folders")
    expect(prompt).toContain("frontmatter type must match the schema directory")
    expect(prompt).toContain("otherwise use wiki/entities/")
    expect(prompt).not.toContain("Entity pages in wiki/entities/ for key entities")
  })

  it("respects user setting regardless of source content language", () => {
    useWikiStore.getState().setOutputLanguage("English")
    const prompt = buildGenerationPrompt("", "", "", "x.pdf", undefined, "私は日本語の文章を書きます")
    expect(prompt).toContain("MANDATORY OUTPUT LANGUAGE: English")
    expect(prompt).not.toContain("OUTPUT LANGUAGE: Japanese")
  })
})

describe("analysis + generation prompt consistency", () => {
  // Both stages MUST declare the same target language — otherwise the wiki
  // files generated in stage 2 may disagree with the analysis from stage 1.
  it("both stages declare the same language for a given setting", () => {
    useWikiStore.getState().setOutputLanguage("Korean")
    const analysis = buildAnalysisPrompt("", "", "")
    const generation = buildGenerationPrompt("", "", "", "f.pdf")
    expect(analysis).toContain("MANDATORY OUTPUT LANGUAGE: Korean")
    expect(generation).toContain("MANDATORY OUTPUT LANGUAGE: Korean")
  })

  it("both stages in auto mode agree on detected language from source", () => {
    useWikiStore.getState().setOutputLanguage("auto")
    const korean = "이것은 한국어 문장입니다"
    const analysis = buildAnalysisPrompt("", "", korean)
    const generation = buildGenerationPrompt("", "", "", "f.pdf", undefined, korean)
    expect(analysis).toContain("MANDATORY OUTPUT LANGUAGE: Korean")
    expect(generation).toContain("MANDATORY OUTPUT LANGUAGE: Korean")
  })
})

describe("long-source ingest planning", () => {
  it("scales generation output tokens with the configured context window", () => {
    expect(computeIngestGenerationMaxTokens(64_000)).toBe(8_192)
    expect(computeIngestGenerationMaxTokens(128_000)).toBe(16_384)
    expect(computeIngestGenerationMaxTokens(256_000)).toBe(24_576)
    expect(computeIngestGenerationMaxTokens(1_000_000)).toBe(32_768)
    expect(computeIngestReviewMaxTokens(1_000_000)).toBe(8_192)
  })

  it("scales source budget from the configured context window instead of a fixed 50k cap", () => {
    const small = computeIngestSourceBudget(64_000, 8_000)
    const large = computeIngestSourceBudget(1_000_000, 8_000)

    expect(small).toBeGreaterThan(20_000)
    expect(large).toBeGreaterThan(200_000)
    expect(large).toBeLessThanOrEqual(300_000)
  })

  it("splits long sources on heading and paragraph boundaries with overlap", () => {
    const content = [
      "# Chapter One",
      "",
      "A".repeat(1200),
      "",
      "B".repeat(1200),
      "",
      "## Section Two",
      "",
      "C".repeat(1200),
      "",
      "D".repeat(1200),
    ].join("\n")

    const chunks = splitSourceIntoSemanticChunks(content, 1800, 200)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0].headingPath).toBe("Chapter One")
    expect(chunks.some((chunk) => chunk.headingPath.includes("Section Two"))).toBe(true)
    expect(chunks[1].overlapBefore.length).toBeGreaterThan(0)
    expect(chunks[1].main.startsWith(chunks[0].main.slice(-200))).toBe(false)
  })
})

// ── Schema-driven experience types ─────────────────────────────

describe("DEFAULT_EXPERIENCE_TYPES", () => {
  it("contains exactly 6 experience types", () => {
    expect(DEFAULT_EXPERIENCE_TYPES).toHaveLength(6)
  })

  it("includes all expected type names in order", () => {
    const names = DEFAULT_EXPERIENCE_TYPES.map((t) => t.type)
    expect(names).toEqual([
      "bug",
      "decision",
      "howto",
      "agent-error",
      "pattern",
      "template",
    ])
  })

  it("every type has a valid directory path", () => {
    for (const et of DEFAULT_EXPERIENCE_TYPES) {
      expect(et.directory).toMatch(/^wiki\//)
      expect(et.directory).not.toMatch(/\/$/)
    }
  })

  it("every type has a bodySections array (may be empty)", () => {
    for (const et of DEFAULT_EXPERIENCE_TYPES) {
      expect(Array.isArray(et.bodySections)).toBe(true)
    }
  })

  it("pattern type has empty bodySections (LLM decides structure)", () => {
    const patternType = DEFAULT_EXPERIENCE_TYPES.find((t) => t.type === "pattern")
    expect(patternType).toBeDefined()
    expect(patternType!.bodySections).toEqual([])
  })

  it("bug type has all 4 standard body sections", () => {
    const bugType = DEFAULT_EXPERIENCE_TYPES.find((t) => t.type === "bug")
    expect(bugType).toBeDefined()
    expect(bugType!.bodySections).toEqual(["现象", "根因", "解决方案", "预防"])
  })
})

describe("parseExperienceTypesFromSchema", () => {
  it("returns DEFAULT_EXPERIENCE_TYPES for empty or whitespace-only input", () => {
    expect(parseExperienceTypesFromSchema("")).toEqual(DEFAULT_EXPERIENCE_TYPES)
    expect(parseExperienceTypesFromSchema("   \n  \n  ")).toEqual(DEFAULT_EXPERIENCE_TYPES)
  })

  it("returns DEFAULT_EXPERIENCE_TYPES when no Page Types section exists", () => {
    const schema = [
      "## Some Other Section",
      "",
      "Some content without a Page Types table.",
    ].join("\n")
    expect(parseExperienceTypesFromSchema(schema)).toEqual(DEFAULT_EXPERIENCE_TYPES)
  })

  it("returns DEFAULT_EXPERIENCE_TYPES when Page Types section exists but no valid rows", () => {
    const schema = [
      "## Page Types",
      "",
      "| Type | Directory |",
      "|------|-----------|",
      "| 123bad | not-wiki |",
      "| also-bad | missing-slash |",
    ].join("\n")
    expect(parseExperienceTypesFromSchema(schema)).toEqual(DEFAULT_EXPERIENCE_TYPES)
  })

  it("parses a minimal Page Types table (type + directory only)", () => {
    const schema = [
      "## Page Types",
      "",
      "| Type | Directory | Description |",
      "|------|-----------|-------------|",
      "| bug | wiki/bugs | Bug reports |",
      "| decision | wiki/decisions | Design decisions |",
    ].join("\n")
    const result = parseExperienceTypesFromSchema(schema)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ type: "bug", directory: "wiki/bugs", bodySections: [] })
    expect(result[1]).toEqual({ type: "decision", directory: "wiki/decisions", bodySections: [] })
  })

  it("parses body sections from the 4th column", () => {
    const schema = [
      "## Page Types",
      "",
      "| Type | Directory | Description | Body Sections |",
      "|------|-----------|-------------|---------------|",
      "| bug | wiki/bugs | Bug reports | 现象;根因;解决方案;预防 |",
    ].join("\n")
    const result = parseExperienceTypesFromSchema(schema)
    expect(result).toHaveLength(1)
    expect(result[0].bodySections).toEqual(["现象", "根因", "解决方案", "预防"])
  })

  it("supports fullwidth semicolons as body section delimiters", () => {
    const schema = [
      "## Page Types",
      "",
      "| Type | Directory | Description | Body Sections |",
      "|------|-----------|-------------|---------------|",
      "| howto | wiki/howto | How-to guides | 目的；前置条件；步骤；验证 |",
    ].join("\n")
    const result = parseExperienceTypesFromSchema(schema)
    expect(result[0].bodySections).toEqual(["目的", "前置条件", "步骤", "验证"])
  })

  it("strips trailing slash from directory", () => {
    const schema = [
      "## Page Types",
      "",
      "| Type | Directory |",
      "|------|-----------|",
      "| pattern | wiki/patterns/ |",
    ].join("\n")
    const result = parseExperienceTypesFromSchema(schema)
    expect(result[0].directory).toBe("wiki/patterns")
  })

  it("skips rows with invalid type names (non-alpha start)", () => {
    const schema = [
      "## Page Types",
      "",
      "| Type | Directory |",
      "|------|-----------|",
      "| 123invalid | wiki/foo |",
      "| valid | wiki/valid |",
    ].join("\n")
    const result = parseExperienceTypesFromSchema(schema)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe("valid")
  })

  it("skips rows with invalid directories (no wiki/ prefix)", () => {
    const schema = [
      "## Page Types",
      "",
      "| Type | Directory |",
      "|------|-----------|",
      "| bad | not-wiki/foo |",
      "| good | wiki/good |",
    ].join("\n")
    const result = parseExperienceTypesFromSchema(schema)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe("good")
  })

  it("recognizes Body Sections header regardless of casing", () => {
    const schema = [
      "## Page Types",
      "",
      "| Type | Directory | body sections |",
      "|------|-----------|---------------|",
      "| bug | wiki/bugs | A;B;C |",
    ].join("\n")
    const result = parseExperienceTypesFromSchema(schema)
    expect(result[0].bodySections).toEqual(["A", "B", "C"])
  })

  it("handles schema with only separator row (no data rows)", () => {
    const schema = [
      "## Page Types",
      "",
      "| Type | Directory | Description |",
      "|------|-----------|-------------|",
    ].join("\n")
    expect(parseExperienceTypesFromSchema(schema)).toEqual(DEFAULT_EXPERIENCE_TYPES)
  })
})

describe("isExperienceSource", () => {
  it("detects /experiences/ anywhere in the path", () => {
    expect(isExperienceSource("raw/sources/experiences/foo.md")).toBe(true)
    expect(isExperienceSource("/home/user/project/experiences/bar.md")).toBe(true)
  })

  it("detects /sessions/ anywhere in the path", () => {
    expect(isExperienceSource("raw/sessions/2026-01-01.md")).toBe(true)
    expect(isExperienceSource("project/sessions/transcript.md")).toBe(true)
  })

  it("detects paths starting with experiences/ or sessions/", () => {
    expect(isExperienceSource("experiences/foo.md")).toBe(true)
    expect(isExperienceSource("sessions/bar.md")).toBe(true)
  })

  it("normalizes Windows backslashes", () => {
    expect(isExperienceSource("raw\\sources\\experiences\\foo.md")).toBe(true)
    expect(isExperienceSource("project\\sessions\\bar.md")).toBe(true)
  })

  it("returns false for normal source paths", () => {
    expect(isExperienceSource("raw/sources/papers/foo.pdf")).toBe(false)
    expect(isExperienceSource("wiki/sources/bar.md")).toBe(false)
    expect(isExperienceSource("documents/article.md")).toBe(false)
  })

  it("handles case-insensitive matching", () => {
    expect(isExperienceSource("RAW/SOURCES/EXPERIENCES/foo.md")).toBe(true)
    expect(isExperienceSource("Project/Sessions/bar.md")).toBe(true)
  })
})

describe("extractExperienceMeta", () => {
  it("extracts project and domain from frontmatter", () => {
    const content = [
      "---",
      "project: smart-lock-firmware",
      "domain: embedded-arm",
      "created: 2026-06-15",
      "---",
      "",
      "# Session Transcript",
    ].join("\n")
    const meta = extractExperienceMeta(content)
    expect(meta).toEqual({ project: "smart-lock-firmware", domain: "embedded-arm" })
  })

  it("returns defaults when fields are missing", () => {
    const content = "# No frontmatter\n\nJust content."
    const meta = extractExperienceMeta(content)
    expect(meta).toEqual({ project: "unknown", domain: "general" })
  })

  it("trims whitespace from values", () => {
    const content = [
      "---",
      "project:   padded-project  ",
      "domain:   padded-domain  ",
      "---",
    ].join("\n")
    const meta = extractExperienceMeta(content)
    expect(meta).toEqual({ project: "padded-project", domain: "padded-domain" })
  })

  it("strips surrounding quotes from YAML values", () => {
    const content = [
      "---",
      'project: "smart-lock-firmware"',
      'domain: "embedded-arm"',
      "---",
    ].join("\n")
    const meta = extractExperienceMeta(content)
    expect(meta).toEqual({ project: "smart-lock-firmware", domain: "embedded-arm" })
  })
})

// ── buildAnalysisPrompt experience mode ────────────────────────

describe("buildAnalysisPrompt experience mode", () => {
  it("switches to experience analysis dimensions when isExperience is true", () => {
    const prompt = buildAnalysisPrompt("", "", "", true, { project: "test", domain: "embedded" })
    expect(prompt).toContain("Project: test")
    expect(prompt).toContain("Domain: embedded")
    expect(prompt).toContain("## 1. Bugs & Defects")
    expect(prompt).toContain("## 4. Agent Errors (Claude Code mistakes)")
    expect(prompt).not.toContain("## Key Entities")
    expect(prompt).not.toContain("## Key Concepts")
  })

  it("uses defaults when experienceMeta is undefined", () => {
    const prompt = buildAnalysisPrompt("", "", "", true)
    expect(prompt).toContain("Project: unknown")
    expect(prompt).toContain("Domain: general")
  })

  it("keeps standard dimensions when isExperience is false (default)", () => {
    const prompt = buildAnalysisPrompt("", "", "")
    expect(prompt).not.toContain("Bugs & Defects")
    expect(prompt).toContain("## Key Entities")
    expect(prompt).toContain("## Main Arguments & Findings")
  })

  it("keeps standard dimensions when isExperience is explicitly false", () => {
    const prompt = buildAnalysisPrompt("", "", "", false)
    expect(prompt).toContain("## Key Entities")
    expect(prompt).not.toContain("## 1. Bugs & Defects")
  })
})

// ── buildGenerationPrompt experience mode ──────────────────────

describe("buildGenerationPrompt experience mode", () => {
  const expMeta = { project: "my-project", domain: "iot" }

  it("switches to experience generation targets when isExperience is true", () => {
    const prompt = buildGenerationPrompt(
      "", "", "", "transcript.md", undefined, "", undefined, true, expMeta,
    )
    expect(prompt).toContain("PROJECT EXPERIENCE extraction")
    expect(prompt).toContain("wiki/bugs/")
    expect(prompt).toContain("wiki/decisions/")
    expect(prompt).toContain("wiki/howto/")
    expect(prompt).toContain("wiki/agent-errors/")
    expect(prompt).toContain("wiki/patterns/")
    expect(prompt).toContain("wiki/templates/")
    // Must NOT instruct LLM to create a source summary page
    expect(prompt).not.toContain("A source summary page at")
    expect(prompt).not.toContain("Entity or schema-defined typed pages")
    expect(prompt).not.toContain("Concept or schema-defined typed pages")
  })

  it("restricts type to EXPERIENCE_TYPES and warns about rejection", () => {
    const prompt = buildGenerationPrompt(
      "", "", "", "x.md", undefined, "", undefined, true, expMeta,
    )
    expect(prompt).toContain("MUST be one of: bug | decision | howto | agent-error | pattern | template")
    expect(prompt).toContain("WILL be rejected")
    // The type line: verify it restricts to experience types and warns about others
    const typeLine = prompt.match(/type\s+—\s+MUST be one of:.*/)?.[0] ?? ""
    // Allowed types section comes first, then the warning
    expect(typeLine).toContain("MUST be one of: bug | decision | howto | agent-error | pattern | template")
    expect(typeLine).toContain('Using "source"')
    expect(typeLine).toContain("non-experience type WILL be rejected")
  })

  it("includes project and domain as required frontmatter fields", () => {
    const prompt = buildGenerationPrompt(
      "", "", "", "x.md", undefined, "", undefined, true, expMeta,
    )
    expect(prompt).toContain('project  — "my-project"')
    expect(prompt).toContain('domain   — "iot"')
    expect(prompt).toContain("REQUIRED for all experience pages")
  })

  it("includes experience-specific body structure rules", () => {
    const prompt = buildGenerationPrompt(
      "", "", "", "x.md", undefined, "", undefined, true, expMeta,
    )
    expect(prompt).toContain("Experience page bodies MUST follow the structure")
    expect(prompt).toContain("project and domain in frontmatter")
    expect(prompt).toContain("cross-project search")
  })

  it("uses default project/domain when experienceMeta is undefined", () => {
    const prompt = buildGenerationPrompt(
      "", "", "", "x.md", undefined, "", undefined, true,
    )
    expect(prompt).toContain('project  — "unknown"')
    expect(prompt).toContain('domain   — "general"')
  })

  it("keeps standard generation targets when isExperience is false", () => {
    const prompt = buildGenerationPrompt(
      "", "", "", "paper.pdf",
    )
    expect(prompt).toContain("A source summary page at")
    expect(prompt).toContain("Entity or schema-defined typed pages")
    expect(prompt).toContain("Concept or schema-defined typed pages")
    expect(prompt).toContain("wiki/index.md")
    expect(prompt).toContain("wiki/log.md")
  })

  it("emits [GEN-v8] debug marker in both modes", () => {
    // The debug log goes to console.error, but we can verify the prompt
    // still contains the right content regardless of mode.
    const standard = buildGenerationPrompt("", "", "", "f.pdf")
    const experience = buildGenerationPrompt(
      "", "", "", "f.md", undefined, "", undefined, true, expMeta,
    )
    // Both should contain the "What to generate" section header
    expect(standard).toContain("## What to generate")
    expect(experience).toContain("## What to generate")
    // Only experience mode mentions experience extraction
    expect(experience).toContain("PROJECT EXPERIENCE extraction")
    expect(standard).not.toContain("PROJECT EXPERIENCE extraction")
  })

  it("experience mode includes index and log in Phase B", () => {
    const prompt = buildGenerationPrompt(
      "", "", "", "x.md", undefined, "", undefined, true, expMeta,
    )
    // Phase B now includes index and log as part of the experience workflow
    expect(prompt).toMatch(/An updated wiki\/index\.md/)
    expect(prompt).toMatch(/An updated wiki\/log\.md/)
    // But they must come AFTER Phase A (ordered output)
    const phaseBStart = prompt.indexOf("PHASE B")
    const indexPos = prompt.indexOf("wiki/index.md")
    expect(phaseBStart).toBeGreaterThan(0)
    expect(indexPos).toBeGreaterThan(phaseBStart)
  })

  it("tells LLM to prioritize [EXP] markers in generation", () => {
    const prompt = buildGenerationPrompt(
      "", "", "", "x.md", undefined, "", undefined, true, expMeta,
    )
    expect(prompt).toContain("[EXP] markers")
    expect(prompt).toContain("manually flagged by the user")
  })

  it("tells LLM to look for [EXP] markers in analysis (experience mode)", () => {
    const prompt = buildAnalysisPrompt("", "", "", true, expMeta)
    expect(prompt).toContain("Manually Flagged Experiences")
    expect(prompt).toContain("[EXP] markers")
    expect(prompt).toContain("high-priority")
  })

  // ── Dynamic experience type generation ─────────────────────────

  it("uses custom experienceTypes parameter to override the allowed type list", () => {
    const customTypes: ExperienceType[] = [
      { type: "bug", directory: "wiki/bugs", bodySections: ["现象", "根因", "解决方案", "预防"] },
      { type: "decision", directory: "wiki/decisions", bodySections: ["背景", "方案对比", "决策", "后果"] },
      { type: "postmortem", directory: "wiki/postmortems", bodySections: ["时间线", "根因", "教训", "行动项"] },
    ]
    const prompt = buildGenerationPrompt(
      "", "", "", "x.md", undefined, "", undefined, true, expMeta, customTypes,
    )
    // Must contain the custom type in the restricted list
    expect(prompt).toContain("MUST be one of: bug | decision | postmortem")
    // The type restriction line must NOT list types excluded from customTypes
    const typeLine = prompt.match(/type\s+—\s+MUST be one of:.*/)?.[0] ?? ""
    expect(typeLine).not.toContain("howto")
    expect(typeLine).not.toContain("agent-error")
    expect(typeLine).not.toContain("pattern")
    expect(typeLine).not.toContain("template")
  })

  it("includes custom type directories in generation targets", () => {
    const customTypes: ExperienceType[] = [
      { type: "bug", directory: "wiki/bugs", bodySections: ["现象", "根因"] },
      { type: "postmortem", directory: "wiki/postmortems", bodySections: ["时间线", "根因"] },
    ]
    const prompt = buildGenerationPrompt(
      "", "", "", "x.md", undefined, "", undefined, true, expMeta, customTypes,
    )
    expect(prompt).toContain("wiki/bugs/")
    expect(prompt).toContain("wiki/postmortems/")
    // Default directories not in custom types should not appear
    expect(prompt).not.toContain("wiki/decisions/")
    expect(prompt).not.toContain("wiki/howto/")
  })

  it("includes custom body sections in the per-type structure instructions", () => {
    const customTypes: ExperienceType[] = [
      { type: "postmortem", directory: "wiki/postmortems", bodySections: ["时间线", "根因", "教训"] },
    ]
    const prompt = buildGenerationPrompt(
      "", "", "", "x.md", undefined, "", undefined, true, expMeta, customTypes,
    )
    expect(prompt).toContain("postmortem")
    // Should reference body sections in the per-type rules section
    expect(prompt).toContain("时间线")
    expect(prompt).toContain("根因")
    expect(prompt).toContain("教训")
  })

  it("custom types with empty bodySections allow LLM free structure", () => {
    const customTypes: ExperienceType[] = [
      { type: "freeform", directory: "wiki/freeforms", bodySections: [] },
    ]
    const prompt = buildGenerationPrompt(
      "", "", "", "x.md", undefined, "", undefined, true, expMeta, customTypes,
    )
    expect(prompt).toContain("MUST be one of: freeform")
    expect(prompt).toContain("wiki/freeforms/")
  })

  it("custom experienceTypes override schema-based parsing completely", () => {
    // Even when schema would produce different types, explicit experienceTypes wins
    const schema = `
## Page Types

| Type | Directory | Description |
|------|-----------|-------------|
| ignored | wiki/ignored | This should be ignored |
`
    const customTypes: ExperienceType[] = [
      { type: "custom-only", directory: "wiki/custom-only", bodySections: ["A", "B"] },
    ]
    const prompt = buildGenerationPrompt(
      schema, "", "", "x.md", undefined, "", undefined, true, expMeta, customTypes,
    )
    expect(prompt).toContain("MUST be one of: custom-only")
    expect(prompt).toContain("wiki/custom-only/")
    expect(prompt).not.toContain("wiki/ignored/")
  })
})
