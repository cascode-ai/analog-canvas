---
status: completed
experience: none
---

# Icon-only Centered Library Tiles

## Goal

Make the four-column Library substantially more compact by removing visible in-tile labels and centering the device artwork alone in each box, while retaining full names through accessible labels and hover tooltips.

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
- `plan/2026-08-15-icon-only-centered-library-tiles/plan.md`
- `plan/log.md`

Read-only dependencies:

- Category headings/counts, folds, full button names/tooltips, recents, and placement behavior remain unchanged.

## Work

1. Remove visible compact text from Library and Recent tiles; keep complete `aria-label` and `title` names.
2. Reduce desktop/narrow tile heights around the centered artwork while retaining minimum practical click targets.
3. Update static/browser coverage for icon-only content, exact centering, dimensions, and containment.
4. Inspect desktop and narrow layouts against the running editor.

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
style(editor): use compact centered library icons
```

## Outcome

Library and Recent tiles are now icon-only: visible compact text was removed, while every button retains its complete `aria-label` and `title` name. Desktop tiles dropped from 66px to 52px around centered 40×32px artwork; the narrow layout dropped from 74px to 60px around centered 46×36px artwork. Four columns, categories, folds, recents, and placement behavior remain unchanged.

Validation passed: focused unit tests (2 files / 16 tests), two focused Playwright flows asserting all primary and Recent tiles are icon-only, fully named, exactly centered, correctly sized, and contained at desktop/narrow widths, `pnpm typecheck`, Prettier checks, reviewer suggestion addressed, screenshot inspection at 1280×720, 1024×720, and 720×720, and `git diff --check`.
