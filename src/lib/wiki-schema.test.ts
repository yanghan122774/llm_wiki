import { describe, expect, it } from "vitest"
import {
  parseWikiSchemaRouting,
  pageTypesSectionLines,
  validateWikiPageRouting,
} from "./wiki-schema"

const SCHEMA = `# Wiki Schema

## Page Types

| Type | Directory | Purpose |
| ---- | --------- | ------- |
| source | wiki/sources/ | Source summaries |
| concept | wiki/concepts/ | Ideas |
| method | wiki/methods/ | Methods |
| overview | wiki/ | Top-level overview |
`

describe("pageTypesSectionLines", () => {
  it("extracts lines under ## Page Types heading", () => {
    const md = [
      "# Wiki",
      "",
      "## Page Types",
      "",
      "| Type | Directory |",
      "|------|-----------|",
      "| bug | wiki/bugs/ |",
      "| decision | wiki/decisions/ |",
      "",
      "## Other Section",
    ].join("\n")

    const lines = pageTypesSectionLines(md)
    // Returns all raw lines after the heading (including blanks)
    expect(lines.length).toBeGreaterThanOrEqual(4)
    expect(lines.some((l) => l.includes("| bug |"))).toBe(true)
    expect(lines.some((l) => l.includes("| decision |"))).toBe(true)
    // Does not include lines from later sections
    expect(lines.some((l) => l.includes("Other"))).toBe(false)
  })

  it("returns empty array when there is no Page Types section", () => {
    const lines = pageTypesSectionLines("# Just a heading\n\nSome text")
    expect(lines).toEqual([])
  })

  it("stops at a heading of equal or lower level", () => {
    const md = [
      "## Page Types",
      "",
      "| Type | Directory |",
      "|------|-----------|",
      "| bug | wiki/bugs/ |",
      "",
      "## Other Section",
      "| orphan | wiki/orphans/ |",
    ].join("\n")

    const lines = pageTypesSectionLines(md)
    expect(lines.some((l) => l.includes("orphan"))).toBe(false)
    expect(lines.some((l) => l.includes("bug"))).toBe(true)
  })

  it("handles Body Sections column (4th column)", () => {
    const md = [
      "## Page Types",
      "",
      "| Type | Directory | Description | Body Sections |",
      "|------|-----------|-------------|---------------|",
      "| bug | wiki/bugs/ | Defects | 现象; 根因; 解决方案 |",
    ].join("\n")

    const lines = pageTypesSectionLines(md)
    expect(lines.some((l) => l.includes("现象"))).toBe(true)
  })
})

describe("parseWikiSchemaRouting", () => {
  it("extracts type directories from the Page Types table", () => {
    const routing = parseWikiSchemaRouting(SCHEMA)

    expect(routing.typeDirs).toEqual({
      source: "wiki/sources",
      concept: "wiki/concepts",
      method: "wiki/methods",
      overview: "wiki",
    })
  })

  it("ignores unrelated markdown tables outside the Page Types section", () => {
    const routing = parseWikiSchemaRouting([
      "# Wiki Schema",
      "",
      "| Name | Directory |",
      "| ---- | --------- |",
      "| draft | wiki/drafts/ |",
      "",
      "## Page Types",
      "",
      "| Type | Directory | Purpose |",
      "| ---- | --------- | ------- |",
      "| concept | wiki/concepts/ | Ideas |",
      "",
      "## Examples",
      "",
      "| Type | Directory |",
      "| ---- | --------- |",
      "| person | wiki/people/ |",
    ].join("\n"))

    expect(routing.typeDirs).toEqual({
      concept: "wiki/concepts",
    })
  })
})

describe("validateWikiPageRouting", () => {
  const routing = parseWikiSchemaRouting(SCHEMA)

  it("reports a mismatch between frontmatter type and schema directory", () => {
    const issue = validateWikiPageRouting(
      "wiki/concepts/flash-attention.md",
      [
        "---",
        "type: source",
        "title: Flash Attention",
        "---",
        "",
        "# Flash Attention",
      ].join("\n"),
      routing,
    )

    expect(issue?.message).toContain('type "source" must be under "wiki/sources/"')
  })

  it("allows custom schema types routed by the table", () => {
    expect(
      validateWikiPageRouting(
        "wiki/methods/retrieval.md",
        [
          "---",
          "type: method",
          "title: Retrieval",
          "---",
          "",
          "# Retrieval",
        ].join("\n"),
        routing,
      ),
    ).toBeNull()
  })

  it("does not enforce pages without a parseable type", () => {
    expect(validateWikiPageRouting("wiki/concepts/no-type.md", "# No Type", routing)).toBeNull()
  })
})

describe("validateWikiPageRouting unknown type rejection", () => {
  const experienceRouting = parseWikiSchemaRouting([
    "# Wiki Schema",
    "",
    "## Page Types",
    "",
    "| Type | Directory | Purpose |",
    "| ---- | --------- | ------- |",
    "| bug | wiki/bugs/ | Defects |",
    "| decision | wiki/decisions/ | Architecture decisions |",
  ].join("\n"))

  it("rejects a type not defined in the schema", () => {
    const issue = validateWikiPageRouting(
      "wiki/bugs/some-bug.md",
      ["---", "type: source", "title: Test", "---", "", "# Test"].join("\n"),
      experienceRouting,
    )
    expect(issue).not.toBeNull()
    expect(issue?.message).toContain('Unknown page type "source"')
    expect(issue?.message).toContain("bug, decision")
  })

  it("allows types that are defined in the schema", () => {
    expect(
      validateWikiPageRouting(
        "wiki/bugs/hardfault.md",
        ["---", "type: bug", "title: HardFault", "---", "", "# HardFault"].join("\n"),
        experienceRouting,
      ),
    ).toBeNull()
  })

  it("still enforces type-to-directory matching after unknown type check", () => {
    const issue = validateWikiPageRouting(
      "wiki/decisions/wrong-dir.md",
      ["---", "type: bug", "title: Wrong Dir", "---", "", "# Wrong Dir"].join("\n"),
      experienceRouting,
    )
    expect(issue).not.toBeNull()
    expect(issue?.message).toContain('type "bug" must be under "wiki/bugs/"')
  })
})
