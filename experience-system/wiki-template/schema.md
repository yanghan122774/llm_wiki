# Wiki Schema — Project Experience

## Page Types

| Type | Directory | Purpose |
|------|-----------|---------|
| bug | wiki/bugs/ | Defects with symptoms → root cause → solution → prevention |
| decision | wiki/decisions/ | Architecture/technology choices with rationale and consequences |
| howto | wiki/howto/ | Repeatable procedures with steps and verification |
| agent-error | wiki/agent-errors/ | Claude Code mistakes and how they were corrected |
| pattern | wiki/patterns/ | Recurring bugs sharing a root cause (requires evidence from ≥2 occurrences) |
| template | wiki/templates/ | Reusable checklists and project setup guides |

## Naming Conventions

- Files: `kebab-case.md`
- Bugs: descriptive slug (e.g., `hardfault-on-boot-vector-table.md`)
- Decisions: `NNN-slug.md` (e.g., `001-use-rtos-for-task-scheduling.md`)
- How-to: action-oriented slug (e.g., `setup-arm-gcc-toolchain.md`)
- Agent errors: descriptive slug (e.g., `wrong-linker-script-path.md`)
- Patterns: pattern name (e.g., `startup-code-symbol-conflict.md`)
- Templates: template name (e.g., `embedded-project-kickoff.md`)

## Frontmatter

All pages must include YAML frontmatter:

```yaml
---
type: bug | decision | howto | agent-error | pattern | template
title: Human-readable title
tags: []
related: []
project: "<source-project>"
domain: "<technical-domain>"
sources: []
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

## Index Format

`wiki/index.md` lists all pages grouped by type:

```
## Bugs
- [[page-slug]] — one-line description

## Decisions
- [[page-slug]] — one-line description

## How-To
- [[page-slug]] — one-line description

## Agent Errors
- [[page-slug]] — one-line description

## Patterns
- [[page-slug]] — one-line description

## Templates
- [[page-slug]] — one-line description
```

## Log Format

`wiki/log.md` records activity in reverse chronological order:
```
## YYYY-MM-DD

- ingest | session transcript processed
```

## Cross-referencing Rules

- Use `[[page-slug]]` syntax to link between wiki pages
- Pattern pages MUST link to the bug/agent-error pages that form their evidence
- Template pages should link to relevant patterns for common pitfalls
- Bug pages that are part of a pattern should link back to the pattern page

## Contradiction Handling

When experience pages conflict:
1. Note the contradiction in the relevant page body
2. Different projects or environments may have different constraints — document the context that made each approach correct
3. If a pattern is disproven by new evidence, update its status and link to the counter-evidence
