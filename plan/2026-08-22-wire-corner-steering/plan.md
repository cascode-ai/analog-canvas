---
status: completed
experience: none
---

# Steering the wire corner from the drafting gesture

## Goal

Let a middle-click choose which way a wire corner turns while drafting,
instead of only reaching the 45° mode. An orthogonal elbow can now be pinned
to horizontal-first or vertical-first rather than always inheriting the
incoming segment's direction.

## State and Ownership

Start state from `git status --short --branch`:

```text
## claude/wire-drafting-iteration
```

Branched from `origin/main` after PRs #175 and #177 merged.

- `packages/edit-engine/src/routing-planner.ts`
- `packages/edit-engine/src/wire-path.test.ts`
- `apps/editor/src/app/App.tsx`
- `apps/editor/src/features/wiring/use-wire-interaction.ts`
- `apps/editor/e2e/manual-editor.spec.ts`

- Shared: `WireCornerOrder`, a transient command constraint that never enters
  the persisted model.

## Work

1. Extend `WireCornerOrder` with `horizontal-first` and `vertical-first` and
   teach `appendOrthogonal` to honor them, keeping `auto` (carry the incoming
   direction through the corner) as the default every existing draft uses.
2. Thread the step's corner order through `compileWireDraft`'s orthogonal
   branch, which previously dropped it.
3. Replace the middle-click "toggle routing mode" action with one cycle over
   the corner shapes a wire actually turns with: horizontal-first →
   vertical-first → 45° diagonal.
4. Offer the two new orders in the Corner menu.

## What was already there

Double-click to finish a wire already worked: the canvas `onDoubleClick`
calls `applyWireCanvasPoint(..., finish=true)` while the pointer-down path
ignores `event.detail !== 1`. Confirmed in a running editor — the status reads
"Committed route … Wire remains active". No change was needed, and it had no
coverage, so the new spec exercises it as part of the corner assertions.

## Not done: free-angle segments

Arbitrary-angle wire segments are deliberately out of scope here.
`validateRoute` rejects any Route that is not octilinear, so free angles are a
change to an enforced geometry invariant rather than a drafting option, and
they would touch ERC, extraction, and every golden. That needs a spec/ADR
decision before implementation.

## Validation

- `git diff --check`
- `git status --short --branch`
- `vitest run` full unit suite (1169 passed)
- Full Playwright suite (199 passed), including a new spec that draws the same
  corner twice and asserts the bend point moves from the horizontal leg to the
  vertical one
- `tsc -p tsconfig.check.json`

## Gate Review

- Decision: affected
- Early gates: typecheck, Prettier on changed files
- Affected gates: edit-engine wire-path unit tests, the manual-editor
  Playwright spec that owns wire drafting
- Final gates: remote GitHub Actions on the PR
- Platform risks: none; `WireCornerOrder` is transient and no persisted
  geometry rule changed

## Test Impact

- Decision: tests-updated
- Contracts: orthogonal corner order, including explicit axis over the
  inherited incoming direction; the middle-click cycle.
- Primary checks: `packages/edit-engine/src/wire-path.test.ts`,
  `apps/editor/e2e/manual-editor.spec.ts`

All new cases. The previous corner rule was implicit in `appendOrthogonal`
and had no direct assertion.

## Commit Intent

Commit as:

```text
feat(editor): steer the wire corner with a middle-click cycle
```

## Outcome

Middle-click now steps horizontal-first → vertical-first → 45° diagonal, so
both orthogonal elbows are reachable without opening the Corner menu; the
click previously reached only the diagonal. Double-click-to-finish already
worked and is now covered.
