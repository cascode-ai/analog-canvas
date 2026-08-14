---
status: completed
experience: none
---

# Four-column Library Icons

## Goal

Reduce Library tile and artwork size so each device category displays four quick-place icons per row without sacrificing labels, accessibility, folding, or placement behavior.

## State and Ownership

Start state from `git status --short --branch`:

```text
## agent/compact-complete-library...origin/agent/compact-complete-library
```

The worktree is clean. This compact-density follow-up remains on the existing Library branch.

Owned paths:

- `apps/editor/src/features/editor-shell/shapes-panel.tsx`
- `apps/editor/src/features/editor-shell/shapes-panel.test.ts`
- `apps/editor/src/styles.css`
- `apps/editor/e2e/component-insert.spec.ts`
- `plan/2026-08-15-four-column-library-icons/plan.md`
- `plan/log.md`

Read-only dependencies:

- Library category membership, full accessible names/tooltips, and fold state remain unchanged.

## Work

1. Change category and Recent grids to four columns.
2. Reduce tile artwork, spacing, typography, and minimum height proportionally so four tiles remain legible within the 220–248px desktop Library width.
3. Add a browser geometry assertion proving a four-item category occupies one row.
4. Inspect desktop and narrow layouts against the running editor.

## Validation

- `pnpm test:local apps/editor/src/features/editor-shell/shapes-panel.test.ts apps/editor/src/app/App.test.tsx`
- `pnpm test:e2e:local apps/editor/e2e/component-insert.spec.ts --grep "foldable categorized Library|narrow breakpoint"`
- `pnpm typecheck`
- Prettier checks for changed CSS, browser test, and plan
- Desktop and narrow screenshot inspection against the running Vite editor
- `git diff --check`
- `git status --short --branch`

## Commit Intent

Commit as:

```text
style(editor): fit four library icons per row
```

## Outcome

Library category and Recent grids now use four columns. Desktop tiles use 32×24px artwork, tighter spacing, and 58px minimum height while retaining readable 10px labels; long visual names use concise electrical abbreviations with their complete names preserved in `aria-label` and tooltips. The full-width Library below 860px restores larger 40×30px artwork and 70px tiles while keeping four columns.

Validation passed: focused unit tests (2 files / 16 tests), two focused Playwright flows at the 220px desktop Library boundary and 720px narrow layout, `pnpm typecheck`, Prettier checks, reviewer approval after readability fixes, screenshot inspection at 1280×720, 1024×720, and 720×720, and `git diff --check`.
