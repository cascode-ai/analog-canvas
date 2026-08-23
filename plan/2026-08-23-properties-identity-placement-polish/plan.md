---
status: completed
experience: none
---

# Properties Identity and Placement Polish

## Goal

Simplify the component Properties presentation on current `origin/main` while
preserving the Identity card, compacting placement controls, retaining
amplifier-specific swap actions, and removing two identified explanatory
paragraphs.

## State and Ownership

Start state from `git status --short --branch`:

```text
## codex/properties-identity-placement-polish...origin/main
```

The dedicated worktree is clean. It was created from
`origin/main@2fdf6b53`; no changes or commits from the superseded Properties
worktree are included.

- `apps/editor/src/app/App.tsx`
- `apps/editor/src/styles.css`
- `apps/editor/src/features/editor-shell/tool-icon.tsx`
- `apps/editor/e2e/component-insert.spec.ts`
- `apps/editor/e2e/manual-editor.spec.ts`
- `plan/2026-08-23-properties-identity-placement-polish/plan.md`
- `plan/log.md`

Read-only and shared boundaries:

- Read-only: MOS Bulk controls and every Properties section outside Identity,
  Placement, capacitor terminal help, and Placement Tray introductory text.
- Shared: component rotation and mirror commands, transaction semantics,
  amplifier differential swap behavior, and editor-wide button/theme tokens.

## Work

1. Keep the Identity card but remove the non-actionable Device class row.
2. Put X, Y, rotate, horizontal mirror, and vertical mirror controls on one
   compact row using accessible editor-native icons.
3. Put Return to tray on the following row and preserve amplifier-only input
   and output swap actions in a dedicated row.
4. Remove the named capacitor explanation and replace the verbose Placement
   Tray introduction with compact retained-count state.
5. Update the focused browser contract for the revised visible and accessible
   UI.

## Validation

- `pnpm exec prettier --check apps/editor/src/app/App.tsx apps/editor/src/styles.css apps/editor/src/features/editor-shell/tool-icon.tsx apps/editor/e2e/component-insert.spec.ts plan/2026-08-23-properties-identity-placement-polish/plan.md plan/log.md`
- `pnpm test:e2e:local apps/editor/e2e/component-insert.spec.ts`
- `pnpm test:e2e:local apps/editor/e2e/manual-editor.spec.ts --grep "shows fixed and variable capacitor plate terminals"`
- `pnpm gate:preflight -- --base origin/main`
- `pnpm gate:affected -- --base origin/main`
- `pnpm test:impact -- --base origin/main`
- `git diff --check`
- `git status --short --branch`

## Gate Review

- Decision: affected
- Early gates: `pnpm gate:review:check -- --base origin/main`,
  `pnpm ci:static`, and `pnpm test:impact -- --base origin/main`
- Affected gates: workspace unit tests, component-insert browser test, and
  editor browser tests selected by `pnpm gate:affected -- --base origin/main`
- Final gates: focused and affected validation for branch delivery; canonical
  `pnpm ci:check` plus remote required checks remain mandatory before merging
  or pushing a non-document change to `main`
- Platform risks: responsive layout and icon rendering require Chromium visual
  inspection; no generated artifacts or release-specific files are expected

## Test Impact

- Decision: tests-updated
- Contracts: Identity remains present without Device class; placement exposes
  X/Y plus accessible rotate and mirror actions; Return to tray remains
  reachable; retained count remains visible without the verbose instruction.
- Primary checks: `apps/editor/e2e/component-insert.spec.ts` and the existing
  capacitor terminal case in `apps/editor/e2e/manual-editor.spec.ts` through
  focused `pnpm test:e2e:local` runs

## Commit Intent

Commit as:

```text
refactor(editor): polish identity and placement properties
```

## Outcome

Kept the compact Identity card while removing Device class, replaced the
placement rotation/mirror text controls with three accessible 32px icon
buttons beside X/Y, retained Return to tray on its own row, and kept
differential amplifier swaps in a dedicated row. Removed the capacitor role
explanation and reduced Placement Tray status to a count badge. Browser review
caught and corrected a CSS cascade that initially wrapped the mirror buttons.

Validation completed:

- `pnpm gate:preflight -- --base origin/main`
- `pnpm gate:affected -- --base origin/main` (183 unit files / 1192 tests,
  component-insert 25/25, manual-editor 99/99)
- focused capacitor test 1/1 after building the clean-worktree `@icm/model`
  dependency
- in-app Chromium inspection of ordinary and differential-amplifier Properties
- `git diff --check`

The branch is ready for review; canonical `pnpm ci:check` and remote required
checks remain the mainline merge gate.
