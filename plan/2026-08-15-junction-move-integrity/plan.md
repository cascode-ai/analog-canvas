---
status: completed
experience: none
---

# Junction move integrity

## Goal

Make the existing `move_junction` typed edit reject atomically when it would
leave any incident Route with stale authored waypoint geometry. This implements
the existing Edit Engine contract without adding a new API shape.

## State and Ownership

Start state from `git status --short --branch`:

```text
## codex/unified-move-plan...origin/codex/unified-move-plan
```

The isolated worktree is clean. This follow-up is limited to the transaction
integrity boundary and its direct regression test.

- `packages/edit-engine/src/transaction.ts`
- `packages/edit-engine/src/routing.test.ts`
- `plan/2026-08-15-junction-move-integrity/plan.md`
- `plan/log.md`

Read-only shared dependencies: Edit schemas, Agent action compiler, model
route validation, and routing planners. Existing planners already pair
Junction moves with Route geometry; no Agent/API schema change is authorized.

## Work

1. Require an explicit `set_route_points` or `route_orthogonal` edit for every
   Route incident to a moved Junction in the same transaction.
2. Return a typed atomic precondition failure naming the missing Route.
3. Cover rejection and planner-generated paired success.

## Validation

- `pnpm test:local packages/edit-engine/src/routing.test.ts packages/edit-engine/src/authoring.test.ts`
- `pnpm typecheck`
- `git diff --check`
- `git status --short --branch`

## Commit Intent

Commit as:

```text
fix(edit-engine): require geometry with junction moves
```

## Outcome

`move_junction` now checks every incident Route before mutation. If a Route is
not explicitly authored by `set_route_points` or `route_orthogonal` elsewhere
in the same transaction, the complete transaction rejects with a localized
`EDIT_PRECONDITION` diagnostic naming both the Junction and Route. Existing
route planners already satisfy this requirement.

Validation passed: Edit Engine routing and authoring tests (40/40), workspace
typecheck, Prettier, and `git diff --check`.
