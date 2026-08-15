---
status: completed
experience: none
---

# Restore Bottom Names on Centered Library Tiles

## Goal

Restore visible device names at the bottom of each compact tile while keeping the device artwork exactly centered in the full box and sizing the tile to prevent overlap.

## State and Ownership

Start state from `git status --short --branch`:

```text
## agent/compact-complete-library...origin/agent/compact-complete-library
```

The worktree is clean and the branch remains rebased on current main.

Owned paths:

- `apps/editor/src/features/editor-shell/shapes-panel.tsx`
- `apps/editor/src/features/editor-shell/shapes-panel.test.ts`
- `apps/editor/src/styles.css`
- `apps/editor/e2e/component-insert.spec.ts`
- `plan/2026-08-15-restore-bottom-library-names/plan.md`
- `plan/log.md`

Read-only dependencies:

- Category headings/counts, folds, complete accessible names/tooltips, recents, and placement behavior remain unchanged.

## Work

1. Restore concise one-line visible names for Library and Recent tiles.
2. Keep artwork centered on both axes and anchor names independently at the bottom.
3. Increase tile height only enough to maintain a measured artwork-to-label gap.
4. Update static/browser coverage for names, centering, separation, fit, and Recent behavior.

## Validation

- `pnpm test:local apps/editor/src/features/editor-shell/shapes-panel.test.ts apps/editor/src/app/App.test.tsx`
- `pnpm test:e2e:local apps/editor/e2e/component-insert.spec.ts --grep "foldable categorized Library|narrow breakpoint"`
- `pnpm typecheck`
- Prettier checks for changed source, CSS, browser test, and plan
- Screenshot inspection at 1280×720, 1024×720, and 720×720
- `git diff --check`
- `git status --short --branch`

## Commit Intent

Commit as:

```text
fix(editor): restore names on centered library tiles
```

## Outcome

Concise visible names are restored at the bottom of every Library and Recent tile while device artwork remains centered on the full box. Desktop tiles are 64px high around 40×32px artwork; narrow tiles are 68px high around 46×36px artwork. The measured layout retains a gap between artwork and the one-line label, and complete device names remain available through `aria-label` and `title`.

Validation passed: focused unit tests (2 files / 16 tests), two focused Playwright flows asserting all primary/narrow labels fit, artwork remains exactly centered, tile dimensions and separation hold, and Recent labels/accessibility remain correct, `pnpm typecheck`, Prettier checks, reviewer approval, screenshot inspection at 1280×720, 1024×720, and 720×720, and `git diff --check`.
