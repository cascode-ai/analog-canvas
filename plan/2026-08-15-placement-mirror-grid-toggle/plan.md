---
status: active
experience: none
---

# Transient placement mirrors and grid-dot toggle

## Goal

Allow `Shift+R` and `Shift+V` to mirror the transient preview while placing a
component with `I` or a copy with `C`, and provide one canvas-control button
to hide or show the background grid dots. Keep both preferences/editor states
transient: do not add Project schema, Edit Engine, or Agent API surface.

## State and Ownership

Start state from `git status --short --branch`:

```text
## main...origin/main
```

The worktree was clean before this target; the target now owns the following
paths on `codex/placement-mirror-grid-toggle`.

- `apps/editor/src/interaction/interaction-state.ts`
- `apps/editor/src/interaction/interaction-state.test.ts`
- `apps/editor/src/interaction/editor-shortcuts.ts`
- `apps/editor/src/interaction/editor-shortcuts.test.ts`
- `apps/editor/src/interaction/shortcut-orientation.ts`
- `apps/editor/src/features/clipboard/clipboard.ts`
- `apps/editor/src/features/clipboard/clipboard.test.ts`
- `apps/editor/src/features/component-insert/insert-component-dialog.tsx`
- `apps/editor/src/features/editor-shell/tool-icon.tsx`
- `apps/editor/src/app/App.tsx`
- `apps/editor/e2e/component-insert.spec.ts`
- `docs/specs/editor-interaction.md`
- `plan/2026-08-15-placement-mirror-grid-toggle/plan.md`
- `plan/log.md`
- `plan/root-audit.md`

Read-only shared contracts: the persisted orientation model and Edit Engine
edits. This target may consume their existing rotation/mirror semantics but
must not extend them.

## Work

1. Keep the placement reducer as the sole owner of temporary orientation;
   route `Shift+R` and `Shift+V` there only for active component/copy placement.
2. Apply the same temporary orientation to preview and commit, including each
   copied source instance, so the ghost cannot disagree with the final edit.
3. Add an editor-local grid-dot visibility control beside the canvas zoom
   controls. It changes only SVG background paint.
4. Add focused reducer, shortcut, and clipboard tests; update the accepted
   interaction contract.

## Validation

- `pnpm test:local apps/editor/src/interaction/interaction-state.test.ts apps/editor/src/interaction/editor-shortcuts.test.ts apps/editor/src/interaction/shortcut-orientation.test.ts apps/editor/src/features/clipboard/clipboard.test.ts`
- `pnpm --filter @icm/editor typecheck`
- `pnpm exec prettier --check <changed source and documentation files>`
- `git diff --check`
- `git status --short --branch`

## Commit Intent

Commit as:

```text
fix(editor): mirror transient placements and toggle grid dots
```

## Outcome

Added transient `Shift+R` / `Shift+V` mirrors for I-placement and C-placement.
Copy now records an editor-local ordered orientation command list and applies
the exact same result to both the SVG ghost and typed commit edits. The footer
has an editor-local grid-dot visibility control; neither feature changes the
Project model, Engine protocol, or Agent API.

Focused validation passed:

- focused reducer, shortcut, orientation, and clipboard tests: 30 tests;
- focused Playwright grid and placement-mirror coverage: 2 tests;
- `pnpm typecheck`;
- targeted Prettier check and `git diff --check`.

The full local `pnpm ci:check` completed static checks, 737 unit tests, build,
release smoke, and 112 browser tests. Its shared Vite server then stopped while
the unrelated Project-file replacement test was waiting for the insert dialog;
the remaining 15 browser failures were all consequent connection refusals. The
same Project-file test passed when rerun on an isolated Vite port, so this is a
local shared-server failure rather than evidence of this target's change.

Committed and pushed on `codex/placement-mirror-grid-toggle` as
`fix(editor): mirror transient placements and toggle grid dots`.
Remote required checks remain the mainline merge gate.
