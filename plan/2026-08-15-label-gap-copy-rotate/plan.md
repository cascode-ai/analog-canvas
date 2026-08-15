---
status: completed
experience: none
---

# Fix label grid clearance and copy-preview rotation

## Goal

Keep newly placed and rotated instance labels exactly one Document grid unit
outside the visible symbol, and let `R` rotate a Copy Placement preview before
its first (or repeated) commit.

## State and Ownership

Start state from `git status --short --branch`:

```text
## main...origin/main
```

The worktree was clean before creating
`codex/label-gap-copy-rotate`. This target owns the label placement policy and
transient editor copy interaction. It does not change persisted schema, Agent
API, electrical connectivity, or shortcut meanings outside active copy
placement.

- `packages/derived/src/instance-label-placement.ts`
- `packages/derived/src/instance-label-placement.test.ts`
- `apps/editor/src/features/wiring/route-interaction-geometry.ts`
- `apps/editor/src/features/clipboard/clipboard.ts`
- `apps/editor/src/features/clipboard/clipboard.test.ts`
- `apps/editor/src/interaction/interaction-state.ts`
- `apps/editor/src/interaction/*test.ts`
- `apps/editor/src/interaction/editor-shortcuts.ts`
- `apps/editor/src/app/App.tsx`
- `apps/editor/e2e/manual-editor.spec.ts`
- `docs/specs/editor-interaction.md`
- `plan/root-audit.md`
- `plan/log.md`

Read-only/shared dependencies: model orientation transform, edit-engine
annotation follow semantics, and the canonical grid coordinate contract.

## Work

1. Replace raw-coordinate `1.5` label gaps plus nearest-grid rounding with a
   one-grid-unit, outward-only visual clearance rule for all four sides.
2. Extend the transient Copy Placement state with quarter-turn orientation;
   make `R` rotate its preview and make committed copies use the same rotation.
3. Cover initial versus rotated label clearance and preview/commit copy
   rotation with unit and browser regressions; document both interaction rules.

## Validation

- `pnpm test:local <affected derived, clipboard, interaction, and editor tests>`
- `pnpm test:e2e:local apps/editor/e2e/manual-editor.spec.ts --grep <label/copy rotation regressions>`
- `pnpm typecheck`
- `pnpm format:check`
- `git diff --check`
- `git status --short --branch`

## Commit Intent

Commit as:

```text
fix(editor): align labels and rotate copy previews
```

## Outcome

Replaced the raw `1.5` label clearance and nearest-grid rounding with a full
Document-grid interval and outward-only snapping. Added transient copy
quarter-turn state: `R` now rotates the preview and commits the corresponding
orientation without changing the source selection. The preview also turns
object-attached label offsets so its temporary text remains on the device side.

Validation passed: 30 focused derived/clipboard/interaction tests,
`pnpm typecheck`, `pnpm format:check`, `git diff --check`, and two focused
Playwright regressions covering label-distance stability and copy-preview
rotation.
