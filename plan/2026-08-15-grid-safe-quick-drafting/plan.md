---
status: completed
experience: none
---

# Grid-safe quick drafting creation

## Goal

Ensure every toolbar quick-create Drafting object uses Document-grid coordinates
even after transient pan or zoom leaves the viewport at non-grid coordinates.

## State and Ownership

Start state from `git status --short --branch`:

```text
## codex/label-gap-copy-rotate...origin/codex/label-gap-copy-rotate
```

The worktree is clean. This is a new, bounded target on the user-selected
branch; the prior label-gap/copy-rotate target is committed and read-only.

- `apps/editor/src/app/App.tsx`
- `apps/editor/e2e/drafting.spec.ts`
- `plan/2026-08-15-grid-safe-quick-drafting/plan.md`
- `plan/log.md`

Read-only shared dependencies:

- `packages/model/src/coordinate-domain.ts` owns grid snapping.
- `packages/edit-engine/src/transaction.ts` correctly rejects off-grid edits.
- `docs/specs/editor-interaction.md` defines the persistent-coordinate rule.

## Work

1. Snap viewport-derived Text, Arrow, and Construction Line starting points
   before they enter a transaction. Arrow and Line are presently dormant
   helpers with no UI call site, but remain safe if re-exposed.
2. Add a final snapping boundary in the drafting creation commit helpers so a
   future caller cannot convert merely rounded derived coordinates into page
   coordinates.
3. Add browser coverage that deliberately uses a non-grid viewport and creates
   the user-reachable Text object without a transaction rejection.

## Validation

- `pnpm test:e2e:local apps/editor/e2e/drafting.spec.ts --grep <quick drafting grid regression>`
- `pnpm test:local apps/editor/src/app/App.test.tsx`
- `pnpm typecheck`
- `pnpm format:check`
- `git diff --check`
- `git status --short --branch`

## Commit Intent

Commit as:

```text
fix(editor): snap quick drafting creation to grid
```

## Outcome

- Text, dormant quick Construction Line, and dormant quick Arrow helpers now
  snap their viewport-derived creation anchors to the active Document grid.
- The two phase drafting commit helpers snap all persisted endpoints and
  vertices at their final transaction boundary. Rectangle centers are snapped
  too, preventing half-grid midpoints from violating the page-coordinate
  contract.
- Added a browser regression that zooms to a viewport whose raw Text position
  is off-grid, then verifies successful creation and grid-aligned persisted
  anchor coordinates.
- Validation passed: targeted browser regression; complete drafting browser
  suite (25/25); editor App unit test (12/12); `pnpm typecheck`; `pnpm
format:check`; and `git diff --check`.
