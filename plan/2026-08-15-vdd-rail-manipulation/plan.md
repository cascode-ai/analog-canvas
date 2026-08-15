---
status: completed
experience: none
---

# Make VDD rails stretchable and junction-aware

## Goal

Make a selected VDD `power-rail` remain one editable supply bar after ordinary
wires attach to it: drag its visible ends to resize the rail, and drag the bar
to translate every junction on it while attached non-rail wires stretch
topology-preservingly.

## State and Ownership

Start state from `git status --short --branch` in the dedicated worktree:

```text
## codex/vdd-rail-editing...origin/main
```

The user-facing worktree is dirty on `codex/label-gap-copy-rotate`, including
`App.tsx`; this target uses a clean worktree created from `origin/main` so it
does not overwrite that concurrent target.

- `packages/derived/src/stretch.ts`
- `packages/derived/src/stretch.test.ts`
- `packages/edit-engine/src/routing-planner.ts`
- `packages/edit-engine/src/routing.test.ts`
- `apps/editor/src/app/App.tsx`
- `apps/editor/e2e/manual-editor.spec.ts`
- `plan/root-audit.md`
- `plan/log.md`

Read-only/shared dependencies: the persisted `RoutePresentation` contract,
`add_power_rail` transaction, canonical route geometry, and editor selection
and canvas-drag systems. No electrical net membership or VDD rail file format
changes are in scope.

## Work

1. Derive the connected set of `power-rail` fragments from a selected rail,
   including junctions introduced when an ordinary wire taps the rail.
2. Add a topology-preserving junction-group translation proposal: rail
   fragments and their junctions move together; a non-rail route sharing one
   of those junctions reshapes locally to keep its other endpoint fixed.
3. Give selected VDD rails endpoint resize handles and a bar translation
   handle, and use the rail-specific proposal rather than the loose-route-only
   path.
4. Add unit and browser regressions for resize and movement after a rail tap.

## Validation

- `pnpm test:local packages/derived/src/stretch.test.ts packages/edit-engine/src/routing.test.ts`
- `pnpm test:e2e:local apps/editor/e2e/manual-editor.spec.ts --grep "VDD rail"`
- `pnpm typecheck`
- `pnpm format:check`
- `git diff --check`
- `git status --short --branch`

## Commit Intent

Commit as:

```text
fix(editor): make VDD rails stretchable after taps
```

## Outcome

Implemented a connected `power-rail` component derivation and a
topology-preserving Junction-group translation proposal. Selected VDD rails
now provide a central move handle and two end resize handles even after a wire
tap split the stored rail into fragments. Attached ordinary wires keep their
far endpoint fixed and gain an orthogonal dogleg as needed; the VDD power label
continues to follow its endpoint Junction through its existing object anchor.

Validation passed: focused routing contracts, VDD browser regressions,
typecheck, Prettier, `git diff --check`, and clean branch status. The initial
browser regression exposed an end-handle hit-layer collision with Junctions;
the endpoint hit layer now routes a selected rail's two endpoint drags to the
resize operation while preserving normal Junction selection otherwise.
