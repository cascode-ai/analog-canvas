---
status: completed
experience: none
---

# Derive Junction Dots from Visible Directions

## Goal

Make a visible Junction dot represent a real visual branch: collinear Route
arms and a collinear terminal stem form one conductor direction, while true
three-direction branches and three-or-more coincident terminals remain dotted.

## State and Ownership

Start state from `git status --short --branch`:

```text
## codex/junction-visible-directions...origin/main
```

The dedicated worktree is clean and starts at `origin/main@1634ed2c`. The root
worktree and its unrelated user/worker state are outside this target.

- `packages/derived/src/contact.ts`
- `packages/derived/src/contact.test.ts`
- `apps/editor/e2e/manual-editor.spec.ts`
- `docs/specs/connectivity-and-routing.md`
- `packages/model/src/schema/routing.ts` (comment-only contract clarification)
- `plan/2026-08-22-junction-visible-directions/plan.md`
- `plan/log.md`

Shared dependencies: resolved terminal directions, resolved Route geometry,
SVG Junction rendering, and the accepted connectivity/routing specification.
The Edit Engine, persisted Route/Junction shapes, Net membership, and symbol
geometry are read-only and must not change.

## Work

1. Classify visible branches from distinct directions across both Route and
   terminal incidents, retaining the explicit three-terminal override.
2. Replace the incorrect straight-through-pin expectation and add exact MOS,
   perpendicular tap, corner, rotation/mirroring, and 45-degree coverage.
3. Add one browser regression proving three collinear MOS Gates render without
   a contact dot, then align the accepted specification and schema comment.

## Validation

- `pnpm test:local packages/derived/src/contact.test.ts`
- `pnpm test:e2e:local apps/editor/e2e/manual-editor.spec.ts --grep "collinear MOS Gates"`
- `pnpm gate:preflight -- --base origin/main`
- `pnpm gate:affected -- --base origin/main`
- `pnpm test:impact -- --base origin/main`
- `git diff --check`
- `git status --short --branch`

## Gate Review

- Decision: affected
- Early gates: `gate:review:check`, `ci:static`, and `test:impact`
- Affected gates: derived unit tests; model comment conservatively selects
  hierarchy and project-file browser checks
- Final gates: branch delivery requires `pnpm ci:check` and remote required
  checks before any later merge to `main`; this target stops at a review branch
- Platform risks: SVG/browser regression and transformed pin directions;
  no generated artifact or release path is owned

## Test Impact

- Decision: tests-updated
- Contracts: visible dot classification, collinear terminal continuity, true
  branch display, transformed pin direction, and octilinear direction handling
- Primary checks: `packages/derived/src/contact.test.ts` and the focused
  `apps/editor/e2e/manual-editor.spec.ts` scenario

## Commit Intent

Commit as:

```text
fix(connectivity): derive junction dots from visible directions
```

## Outcome

Junction dots now derive from distinct visible directions across Route arms and
terminal stems, with a separate three-terminal override. The obsolete raw
Route-arm count was removed, the accepted specification and Junction role
comment now distinguish topology anchors from visual dots, and unit/browser
regressions cover the reported three-MOS case plus transforms and 45-degree
branches. Focused tests, preflight, build, and all affected gates passed.
