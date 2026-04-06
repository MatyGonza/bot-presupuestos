# Skill Registry - bot-presupuestos

## User Skills
| Skill | Trigger |
|-------|---------|
| branch-pr | When creating a pull request, opening a PR, or preparing changes for review. |
| issue-creation | When creating a GitHub issue, reporting a bug, or requesting a feature. |
| judgment-day | When user says "judgment day", "judgment-day", "review adversarial", "dual review", "doble review", "juzgar", "que lo juzguen". |
| skill-creator | When user asks to create a new skill, add agent instructions, or document patterns for AI. |

## Compact Rules
### general
- Always use Rioplatense Spanish (voseo) for communication.
- Focus on CONCEPTS > CODE.
- Follow Clean Architecture if applicable.
- Use conventional commits.

### typescript
- Use strict typing.
- Prefer Zod for runtime validation.

### jest
- Follow TDD: write tests before implementation in `sdd-apply`.

### furniture-pricing
- Edge banding (canto) priced by **50m rolls** (White: $12k, Color: $35k).
- Rolls calculated as `Math.ceil(totalMeters / 50)` (No waste factor applied to canto).
- Default internal boards thickness: **15mm** (can be changed to 18mm via `/config`).
- Default: 1 shelf for `bajo_mesada` and `alacena`.
- Door count logic: 1 if W <= 500mm, 2 if W <= 1500mm, 3 if W > 1500mm.
