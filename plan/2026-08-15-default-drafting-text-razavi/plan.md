---
status: completed
experience: none
---

# Default drafting text uses Razavi typography

## Goal

Make text created with `T` begin with the same Razavi typography composition as
schematic annotations: 15.116-unit label size, bold italic main text, and a
bold upright subscript when the user applies subscript formatting.

## State and Ownership

Start state from `git status --short --branch`:

```text
## main...origin/main
```

The worktree was clean. This target is on the dedicated branch
`codex/default-text-razavi-style` and owns:

- `apps/editor/src/app/App.tsx`
- `packages/model/src/semantic-text.ts`
- `packages/model/src/semantic-text.test.ts`
- `packages/render-svg/src/rich-text.ts`
- `packages/render-svg/src/rich-text.test.ts`
- `packages/render-svg/src/current-contract.test.ts`
- `plan/2026-08-15-default-drafting-text-razavi/plan.md`
- `plan/log.md`

Read-only shared dependencies:

- `packages/derived/src/style-profile.ts` defines the authority-approved
  typography tokens.
- `docs/specs/razavi-visual-contract.md` is the visual authority contract.

## Work

1. Add one semantic factory for default drafting text instead of duplicating
   the annotation AST in the editor.
2. Use that factory for `T` text creation with the existing `label`
   typography token.
3. Ensure a subscript span resets italic styling while retaining bold styling,
   matching the accepted annotation composition.
4. Add focused model, renderer, and editor regression assertions.
5. Update the Razavi power-label renderer contract after its previous
   italic-subscript expectation is disproved by the approved text style.

## Validation

- `pnpm test:local packages/model/src/semantic-text.test.ts packages/render-svg/src/rich-text.test.ts apps/editor/src/app/App.test.tsx`
- `pnpm test:local packages/render-svg/src/current-contract.test.ts`
- `pnpm -C packages/model build`
- `pnpm -C packages/render-svg build`
- `pnpm -C apps/editor build`
- `git diff --check`
- `git status --short --branch`

## Commit Intent

Commit as:

```text
fix(editor): default drafting text to Razavi typography
```

## Outcome

- Added `defaultDraftTextDocument()` as the sole initial-content factory for
  free drafting text. It composes ordinary text as bold italic and recognizes
  one conventional underscore suffix as bold upright subscript.
- `T` now uses that factory while retaining its existing `label` token, whose
  Razavi size is 15.116 units.
- Script rendering now resets inherited italic style but retains inherited
  weight, so a selection converted to subscript inside default text renders as
  the same bold upright form as an annotation.
- Validation passed: 20 focused model/renderer/editor tests; model,
  render-svg, and editor builds; Prettier; and `git diff --check`. The first
  full gate correctly found one stale power-label contract expectation, which
  was repaired and retested. The clean-tree `pnpm install --frozen-lockfile &&
pnpm ci:check` gate then passed: static checks, 726 unit/integration tests,
  workspace build, release smoke, and 121 browser tests.
