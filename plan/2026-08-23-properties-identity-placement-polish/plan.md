---
status: completed
experience: none
---

# Properties Identity and Placement Polish

## Goal

Simplify the component Properties presentation on current `origin/main` while
preserving the Identity card, compacting placement controls, retaining
amplifier-specific swap actions, and removing two identified explanatory
paragraphs. Follow up by reducing the Display card to one quiet inline control
row without changing Reference or Value behavior.
Reduce the remaining component card stack by preserving Identity as the sole
emphasized card and expressing the other domains as continuous flat sections.

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
- `apps/editor/src/features/hierarchy/cell-manager-dialog.tsx`
- `apps/editor/src/features/wiring/use-wire-interaction.ts`
- `apps/editor/e2e/component-insert.spec.ts`
- `apps/editor/e2e/manual-editor.spec.ts`
- `packages/edit-engine/src/route-geometry-edit.ts`
- `packages/edit-engine/src/route-geometry-edit.test.ts`
- `plan/2026-08-23-properties-identity-placement-polish/plan.md`
- `plan/log.md`

Read-only and shared boundaries:

- Read-only: MOS Bulk controls and every Properties section outside Identity,
  Placement, capacitor terminal help, and Placement Tray introductory text.
- Shared: component rotation and mirror commands, transaction semantics,
  amplifier differential swap behavior, and editor-wide button/theme tokens.
- Shared: canonical route geometry normalization and direct segment dragging;
  those remain supported while the standalone Jog command is retired.

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
6. Compact the Display heading and its two required checkboxes into one row,
   removing the nested tile treatment and surplus vertical padding.
7. Merge read-only target identity into Identity and combine Parameters,
   Display, and Advanced inside one card. Keep card boundaries for Identity,
   the combined electrical group, Placement, and conditional Model, terminal,
   or provenance groups without restoring the former one-card-per-row stack.
8. Remove the standalone Wire Jog command end to end—UI actions, interaction
   adapter, edit-engine helpers, and their command-specific tests—while keeping
   direct segment dragging and general route normalization intact.
9. Replace the browser-owned Clear canvas confirmation with an editor-native,
   undo-aware confirmation dialog. Rework the Cell Manager create, rename, and
   delete prompts into the same compact header/body/footer visual hierarchy so
   New Cell matches the global dialog language.

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
- Follow-up review: the Display-only revision uses `HEAD` as its base because
  the preceding target commit is already pushed and fully validated; its
  affected selection is static checks, workspace units, and component-insert
  browser tests.
- Card-stack review: use the latest pushed `HEAD` as the follow-up base; App,
  styles, component-insert, and manual-editor select workspace units plus both
  editor browser contracts. Human review rejected removing every card boundary,
  so the implementation must reduce card count by grouping related content,
  not by flattening all domains. MOS Bulk, Tray, Issues, and data semantics
  remain read-only.
- Jog removal review: the expanded route-edit surface selects workspace unit,
  hierarchy browser, and manual-editor browser gates. Validation is deliberately
  deferred until the human finishes the current UI review.
- Native-dialog review: App, Cell Manager, shared editor styles, manual-editor,
  and hierarchy browser contracts are the owned surface. Clear remains an
  undoable destructive transaction; Cell creation/rename/delete semantics are
  unchanged. Validation remains deferred during the active human review.

## Test Impact

- Decision: tests-updated
- Contracts: Identity remains present without Device class; placement exposes
  X/Y plus accessible rotate and mirror actions; Return to tray remains
  reachable; retained count remains visible without the verbose instruction;
  Display keeps Reference and Value on one compact row.
- Added contract: a normal resistor keeps exactly three purposeful cards—
  Identity, combined Parameters/Display/Advanced, and Placement—with its
  read-only target inside Identity.
- Retired contract: explicit Add/Straighten Jog commands. Existing direct route
  segment movement remains the primary protected geometry-edit behavior.
- Replaced contract: Clear canvas confirmation is now an accessible app dialog
  rather than a browser dialog; Cell Manager prompts retain their existing
  accessible names and actions inside a consistent structured surface.
- Primary checks: `apps/editor/e2e/component-insert.spec.ts` and the existing
  capacitor terminal case in `apps/editor/e2e/manual-editor.spec.ts` through
  focused `pnpm test:e2e:local` runs

## Commit Intent

Follow-up commit as:

```text
refactor(editor): simplify properties and dialogs
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

Display-card follow-up completed: the heading and both required checkboxes now
share one 32px-high row, while the nested toggle tiles, fill colors, and surplus
vertical padding are removed. Reference and Value behavior is unchanged.

Follow-up validation completed relative to the preceding pushed commit:

- `pnpm gate:preflight -- --base HEAD`
- `pnpm gate:affected -- --base HEAD` (183 unit files / 1192 tests and
  component-insert 25/25)
- focused Display test 1/1
- in-app Chromium inspection at the live localhost, including measured card
  height and grid columns
- `git diff --check`

Card-stack, Wire action, and dialog follow-ups completed. A normal primitive
component now has three purposeful cards: Identity, a combined
Parameters/Display/Advanced card, and Placement. Read-only primitive target
information moved into Identity; conditional editable Model, terminal, and
provenance cards remain separate. The standalone Jog UI and its otherwise
unreachable edit-engine helpers were removed while direct route dragging and
normalization remain intact.

Clear canvas now uses an editor-native, undo-aware confirmation dialog instead
of `window.confirm`. Cell Manager create, rename, and delete prompts share the
same compact header/body/footer surface, accessible names, focus behavior, and
primary/danger action hierarchy. Browser inspection caught an undefined danger
token and the first hierarchy run caught an unstable delete-dialog accessible
name; both were corrected before the complete gate rerun.

Final validation completed against `origin/main`:

- `pnpm gate:preflight -- --base origin/main`
- `pnpm gate:affected -- --base origin/main` (183 unit files / 1191 tests,
  component-insert 25/25, hierarchy 13/13, manual-editor 98/98)
- `pnpm install --frozen-lockfile`
- `pnpm ci:check` (183 unit files / 1191 tests, production build, release and
  golden checks, full browser suite 211/211)
- in-app Chromium inspection of Clear canvas and New Cell dialogs
- `git diff --check`
