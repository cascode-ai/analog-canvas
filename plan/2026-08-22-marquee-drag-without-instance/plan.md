---
status: completed
experience: none
---

# Dragging a marquee selection that holds no Instance

## Goal

Make a marquee selection move as one group however it was composed. Dragging
a selection of only Routes, Junctions, or Annotations moved just the grabbed
object and left the rest behind.

## State and Ownership

Start state from `git status --short --branch`:

```text
## claude/marquee-drag
```

Branched from `origin/main` after PR #184 merged.

- `apps/editor/src/app/App.tsx`
- `apps/editor/e2e/manual-editor.spec.ts`

## The defect

Reproduced before fixing: two standalone wires, marquee across both (status
"Selected 6 objects", both Routes marked `selected`), then drag one. Only the
grabbed Route moved — `dy 70` against `dy 0` — and the status read "Moved
loose route …", a single-object move.

`compositeSelectionOwnsHit` required `selectedIds.length > 0`, and
`selectedIds` holds only Instances. A marquee with no Instance therefore never
counted as a composite selection, so the press fell through to the
single-object branches: a Route dragged alone, and a Junction only re-selected
itself, which reads as the drag doing nothing at all.

That is what made it intermittent — the group move worked whenever the
selection happened to include an Instance.

## Work

1. Count a composite selection across every kind (Instances, Routes,
   Junctions, Annotations, drafting objects) rather than requiring an
   Instance.
2. When the composite selection owns the hit but has no Instance to anchor
   the move, fall back to `beginVisualSelectionMoveFromSelection`, guarded by
   `planSelectionMove` exactly as the existing route-tap path does.

## Validation

- `git diff --check`
- `git status --short --branch`
- Full unit suite (1172 passed), full Playwright suite (204 passed)
- The new e2e case was re-run with the fix stashed and fails without it
  (`Expected 70, Received 0`)
- `tsc -p tsconfig.check.json`

## Gate Review

- Decision: affected
- Early gates: typecheck, Prettier on changed files
- Affected gates: the manual-editor Playwright spec that owns selection and
  movement
- Final gates: remote GitHub Actions on the PR
- Platform risks: `compositeSelectionOwnsHit` gates every canvas press, so the
  full browser suite was run rather than the selection specs alone

## Test Impact

- Decision: tests-updated
- Contracts: a multi-object selection moves as one group regardless of which
  kinds it contains.
- Primary checks: `apps/editor/e2e/manual-editor.spec.ts`

## Commit Intent

Commit as:

```text
fix(editor): move a marquee selection that contains no Instance
```

## Outcome

Both wires now move together and the edit commits as one group revision
instead of a single-route move.
