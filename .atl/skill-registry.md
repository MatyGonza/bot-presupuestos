# Skill Registry

**Delegator use only.** Any agent that launches sub-agents reads this registry to resolve compact rules, then injects them directly into sub-agent prompts. Sub-agents do NOT read this registry or individual SKILL.md files.

See `_shared/skill-resolver.md` for the full resolution protocol.

## User Skills

| Trigger | Skill | Path |
|---------|-------|------|
| When creating a pull request, opening a PR, or preparing changes for review. | branch-pr | C:\Users\home\.gemini\antigravity\skills\branch-pr\SKILL.md |
| When writing Go tests, using teatest, or adding test coverage. | go-testing | C:\Users\home\.gemini\antigravity\skills\go-testing\SKILL.md |
| When creating a GitHub issue, reporting a bug, or requesting a feature. | issue-creation | C:\Users\home\.gemini\antigravity\skills\issue-creation\SKILL.md |
| When user says "judgment day", "judgment-day", "review adversarial", "dual review", "doble review", "juzgar", "que lo juzguen". | judgment-day | C:\Users\home\.gemini\antigravity\skills\judgment-day\SKILL.md |
| When user asks to create a new skill, add agent instructions, or document patterns for AI. | skill-creator | C:\Users\home\.gemini\antigravity\skills\skill-creator\SKILL.md |

## Compact Rules

Pre-digested rules per skill. Delegators copy matching blocks into sub-agent prompts as `## Project Standards (auto-resolved)`.

### branch-pr
- Do NOT push code directly to `main` or active branch; instead create a PR branch safely.
- Write PR descriptions prioritizing architecture explanations over changelogs.
- Always link the PR to a corresponding Issue if one exists.

### go-testing
- Use table-driven tests for multiple inputs/outputs in standard Go testing.
- For TUI applications, always use `teatest` and assert output models.
- Assert errors immediately and log clearly on boundary failures.

### issue-creation
- Prefix issue titles with domain tags (e.g. `[NLU]`, `[Bot]`).
- Separate 'Root Cause' from 'Proposed Fix' concisely.
- Add context for reproduction steps over generalized bug statements.

### judgment-day
- Run independent code audits blindly across file structures.
- Focus explicitly on memory usage, state leaks, and architectural coupling.
- Auto-escalate if the same bug resurfaces twice in recursive review.

### skill-creator
- Keep instructions focused on boundaries, constraints, and constraints.
- Output skills into standard Markdown structure with YAML Frontmatter.
- Make triggers explicit using "When doing X" patterns.

## Project Conventions

| File | Path | Notes |
|------|------|-------|
| AGENTS.md | c:\Users\home\Desktop\git,github\proyecto personal\AGENTS.md | Index/Convention rules |

Read the convention files listed above for project-specific patterns and rules. All referenced paths have been extracted — no need to read index files to discover more.
