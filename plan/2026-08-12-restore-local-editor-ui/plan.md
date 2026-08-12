---
status: completed
experience: none
---

# Restore local editor UI on current remote behavior

## Goal

Recreate the validated local editor chrome from `feat/editor-chrome-shell` on
top of current `origin/main`, while preserving the remote connectivity/routing,
analytics, deployment, and safe Library quick-place behavior added after the
local UI branch diverged.

## State and Ownership

Start state from `git status --short --branch`:

```text
## feat/editor-chrome-shell...chrome-fork/feat/editor-chrome-shell
```

The worktree was clean before this plan. The local UI branch and remote main
share `ed5b216`; remote main deliberately omitted the whole-shell redesign and
then advanced shared `App.tsx` behavior, so this target uses a fresh restoration
branch and a bounded semantic port rather than replacing remote files wholesale.

Owned paths:

- `apps/editor/src/app/App.tsx`
- `apps/editor/src/styles.css`
- `apps/editor/src/features/editor-shell/*`
- `apps/editor/src/features/component-insert/*` only if required to preserve the remote quick-place contract
- `apps/editor/src/components/editor-help-dialog.tsx`
- `apps/editor/src/app/App.test.tsx`
- `apps/editor/e2e/component-insert.spec.ts`
- `apps/editor/e2e/drafting.spec.ts`
- `apps/editor/e2e/manual-editor.spec.ts`
- `docs/specs/editor-interaction.md`
- `plan/2026-08-12-restore-local-editor-ui/plan.md`
- `plan/log.md`

Read-only/shared dependencies:

- connectivity, routing, search, diagnostics, analytics, worker, and deployment code now on `origin/main`
- current public Project/Document and editor interaction contracts

## Work

1. Establish a branch rooted at current `origin/main` and reproduce the local
   shell structure and styling without reverting remote functional behavior.
2. Reconcile the local Shapes/Library chrome with the newer remote quick-place
   implementation and retain remote connectivity, analytics, and editor fixes.
3. Update focused tests only where the restored chrome changes accepted UI
   structure or locators.
4. Review the combined diff for accidental replacement of post-divergence
   behavior.

## Validation

- focused editor unit tests for App and ShapesPanel
- focused Playwright chrome, component insertion, drafting, and manual-editor tests
- `pnpm typecheck`
- `pnpm --filter @icm/editor build`
- `git diff --check`
- `git status --short --branch`

Because this is a non-document editor integration intended for remote delivery,
the canonical clean install and `pnpm ci:check` plus required remote checks are
required before merge/push to `main`.

## Commit Intent

Commit as:

```text
fix(editor): restore local chrome on current main
```

## Outcome

Restored the local editor chrome on current `origin/main` through a semantic
integration rather than reverting remote `App.tsx`. The result keeps the
menubar/tool strip, left tool rail, Shapes/Library panel, in-flow Properties
dock, canvas workspace, bottom status/zoom bar, and local visual scale while
retaining remote connectivity, routing, diagnostics, search, analytics,
component quick-place, persistence, and double-click behavior. The narrow
collapsed-Library grid no longer reserves an invisible row.

Validation completed: focused App/ShapesPanel tests (14/14); focused editor
Playwright suite (89/89, with the flaky viewport assertion stabilized and its
relevant cases repeated 3 times); workspace typecheck; editor dependency-closure
build; Prettier checks; and `git diff --check`. Full frozen-install `pnpm
ci:check` and remote required checks remain delivery gates for merging to
`main` and were not run as part of this local restoration.

This commit closes the target with `status: completed`; experience remains
`none`.
