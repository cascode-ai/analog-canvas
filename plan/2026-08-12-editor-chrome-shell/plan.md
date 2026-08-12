---
status: completed
experience: none
---

# layout + chrome redesign

## Goal

Redesign the editor shell so the layout is easier to scan and operate, using
information architecture (menubar, tool strip, canvas, right format
panel, status bar) and visual details (calm surfaces, soft borders,
quiet hover states). Preserve existing editing contracts, testids, and File /
Edit / Draw / More command names.

## State and Ownership

Start state from `git status --short --branch`:

```text
## main...origin/main
```

Worktree was clean.

Owned paths:

- `apps/editor/src/app/App.tsx`
- `apps/editor/src/styles.css`
- `apps/editor/src/features/editor-shell/tool-icon.tsx`
- `apps/editor/e2e/component-insert.spec.ts`
- `apps/editor/e2e/manual-editor.spec.ts`
- `apps/editor/e2e/drafting.spec.ts`
- `apps/editor/src/app/App.test.tsx`
- `docs/specs/editor-interaction.md`
- `plan/2026-08-12-editor-chrome-editor-chrome/plan.md`
- `plan/log.md`

## Work

1. Restructured shell into menubar, primary tool strip, left tool rail, canvas,
   right Properties panel, and bottom status bar.
2. Restyled chrome with tokens; formal schematic canvas export
   styling remains untouched.
3. Kept File / Edit / Draw / More menus and insert dialog; mirrored high-frequency
   tools on the strip and rail.
4. Updated interaction contract to v1.7 for the new chrome IA.
5. Adjusted e2e for in-flow Properties reflow and macOS text-select shortcuts.
6. Fixed guide hit-testing so visual guides no longer steal pointer events from
   `.guide-hit`.

## Validation

- `pnpm exec vitest run apps/editor/src/app/App.test.tsx` — pass
- `CI=1 ICM_E2E_ISOLATED=1 pnpm exec playwright test` — 73 passed
- `pnpm exec prettier --check` on touched files — pass
- `git diff --check` — pass

## Commit Intent

Commit as:

```text
Redesign editor chrome to layout with details
```

## Outcome

Editor chrome now uses a shell (menubar + tool strip + left tool
rail + right Properties + status bar) with calm surfaces. Insert
remains dialog-based; formal schematic styling is unchanged. Focused unit and
full editor e2e suites passed.
