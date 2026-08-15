---
status: completed
experience: none
---

# Center the Library Icon-label Group

## Goal

Center the combined visual weight (`重心`) of each device picture plus its bottom name within the tile, rather than centering the picture alone.

## State and Ownership

Start state from `git status --short --branch`:

```text
## agent/compact-complete-library...origin/agent/compact-complete-library
```

The worktree is clean and the branch remains rebased on current main.

Owned paths:

- `apps/editor/src/styles.css`
- `apps/editor/e2e/component-insert.spec.ts`
- `plan/2026-08-15-center-library-icon-label-group/plan.md`
- `plan/log.md`

Read-only dependencies:

- Visible compact names, full accessible names/tooltips, four columns, categories, folds, recents, and placement behavior remain unchanged.

## Work

1. Return picture and name to normal tile flow as one fixed-size visual group.
2. Vertically center that combined group while preserving horizontal centering and a clear picture/name gap.
3. Keep desktop and narrow tile heights compact around the centered group.
4. Update browser geometry coverage to measure the union center of artwork and label.

## Validation

- `pnpm test:local apps/editor/src/features/editor-shell/shapes-panel.test.ts apps/editor/src/app/App.test.tsx`
- `pnpm test:e2e:local apps/editor/e2e/component-insert.spec.ts --grep "foldable categorized Library|narrow breakpoint"`
- `pnpm typecheck`
- Prettier checks for changed CSS, browser test, and plan
- Screenshot inspection at 1280×720, 1024×720, and 720×720
- `git diff --check`
- `git status --short --branch`

## Commit Intent

Commit as:

```text
fix(editor): center library icon-label groups
```

## Outcome

Each tile now treats the artwork and its one-line name as a single visual group and centers the union of their bounds on the tile’s vertical midpoint. Artwork and label remain independently centered horizontally with a fixed gap. Desktop tiles are 56px high around 40×32px artwork; narrow tiles are 64px high around 46×36px artwork.

Validation passed: focused unit tests (2 files / 16 tests), two focused Playwright flows measuring the exact artwork-label union center, artwork/label horizontal centers, separation, fit, dimensions, folds, and Recent behavior at desktop/narrow widths, `pnpm typecheck`, Prettier checks, reviewer approval, screenshot inspection at 1280×720, 1024×720, and 720×720, and `git diff --check`.
