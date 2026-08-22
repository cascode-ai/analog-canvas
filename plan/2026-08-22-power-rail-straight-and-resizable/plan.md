---
status: completed
experience: none
---

# A Power Rail stays straight and resizes from its ends

## Goal

Make a Power Rail behave as the one thing it can be: a single straight
conductor whose length is editable. Dragging an end must lengthen the rail
rather than translate it, and no edit may leave a rail bent.

## State and Ownership

Start state from `git status --short --branch`:

```text
## claude/power-rail-straight
```

Branched from `origin/main` after PR #181 merged.

- `apps/editor/src/app/App.tsx`
- `packages/edit-engine/src/transaction-routing.ts`
- `packages/edit-engine/src/transaction.test.ts`
- `apps/editor/e2e/manual-editor.spec.ts`

- Shared: `validateRoute`, the routing invariant every transaction is checked
  against.

## The resize defect

Reproduced before fixing: placing a rail and dragging its end junction moved
the whole rail (both ends `+100`) and reported "Moved Power Rail".

The rail's `power-rail-handle-…-end` circle is drawn _under_ the junction's
`endpoint-hit` circle. `handleCanvasHitPointerDown` runs on
`onPointerDownCapture` and skipped handles by testing only `event.target`,
which is the topmost element — the endpoint circle — so the guard missed, the
capture layer claimed the press with `stopPropagation`, and the endpoint
circle's own resize branch never ran.

The existing e2e case passed only because it connects a wire first, which
stops the junction being a free wiring endpoint and removes the covering
circle. That is why the bug survived: the test drove a state real usage does
not start from.

Fix: rank the whole element stack at the point, not just `event.target`.

## The straightness invariant

`add_power_rail` already required one axis-aligned segment, and
`validateRoute` already required each stored rail Route to be straight. Both
are per-Route, and `proposeWireCommit` gives any wire drawn from a rail
endpoint `presentation: "power-rail"`, so a perpendicular branch produced a
bent rail out of two individually straight halves.

`validateRoute` now also requires the whole connected rail run to be
collinear. Extending a rail along its own axis still succeeds.

## Historical data

The rule is enforced through `validateRoute`, which the transaction layer
already grandfathers for pre-existing errors on unchanged geometry: an
already-bent Project still opens, but any edit touching that rail must leave
it straight. Nothing is silently straightened.

## Validation

- `git diff --check`
- `git status --short --branch`
- Full unit suite (1170 passed); the new transaction case was re-run with the
  invariant stashed to confirm it fails without it
- Full Playwright suite (200 passed), including a new case that resizes a
  plain rail and asserts the fixed end stays put
- `tsc -p tsconfig.check.json`

## Gate Review

- Decision: affected
- Early gates: typecheck, Prettier on changed files
- Affected gates: edit-engine transaction tests, the manual-editor Playwright
  spec that owns rail interaction
- Final gates: remote GitHub Actions on the PR
- Platform risks: the capture-layer change affects every canvas press, so the
  full browser suite was run rather than the rail specs alone

## Test Impact

- Decision: tests-updated
- Contracts: a rail end handle resizes rather than translates; a rail run
  stays collinear.
- Primary checks: `packages/edit-engine/src/transaction.test.ts`,
  `apps/editor/e2e/manual-editor.spec.ts`

## Commit Intent

Commit as:

```text
fix(editor): resize a Power Rail from its ends and keep it straight
```

## Outcome

Dragging a rail end now reports "Resized Power Rail" and moves only that end.
A perpendicular rail branch is rejected; a collinear one still extends the
rail.
