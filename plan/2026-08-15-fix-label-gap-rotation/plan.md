---
status: completed
experience: none
---

# Repair exact instance-label gap and rotation stability

## Goal

Restore one exact active-Document grid interval between the rendered instance
label and the rendered symbol edge, and make repeated quarter-turn rotations
stable rather than outwardly drifting the automatic label.

## State and Ownership

Start state from `git status --short --branch`:

```text
## codex/close-label-gap-delivery...origin/main [ahead 1, behind 1]
```

The worktree is clean. This target continues on the user-selected delivery
branch. It owns derived instance-label geometry and the edit-engine follow
logic plus their focused contracts. The pending one-commit `main` divergence
is a VDD-only change and will be merged before delivery; it does not overlap
the owned implementation paths.

- `packages/derived/src/visual.ts`
- `packages/derived/src/instance-label-placement.ts`
- `packages/derived/src/*label-placement*.test.ts`
- `packages/edit-engine/src/transaction.ts`
- `packages/edit-engine/src/*transaction*.test.ts`
- `packages/edit-engine/src/routing.test.ts`
- `docs/specs/editor-interaction.md`
- `plan/2026-08-15-fix-label-gap-rotation/plan.md`
- `plan/root-audit.md`
- `plan/log.md`

Read-only/shared dependencies: model transforms and grid contract, SVG text
metrics, editor annotation rendering, and the current Razavi visual contract.

## Work

1. Expose an unpadded visible-ink symbol bound while retaining the existing
   padded bound for interaction/hit safety.
2. Use the ink bound for automatic instance-label placement, with a fixed
   one-grid visual clearance and no outward re-snap of the text baseline.
3. Reconstruct only the label side during instance rotation; reflow canonical
   labels with the fixed gap rather than deriving and preserving a clearance
   from a previously snapped baseline. Preserve an explicitly moved label as a
   rigid object-relative offset rather than silently reclassifying it as an
   automatic label.
4. Update the editor interaction contract from outward hit-envelope snapping
   to the first canonical grid line from drawn ink; add focused regressions
   for initial/rotated placement and return-to-origin after four quarter turns.
5. Integrate latest `main`, run the mainline delivery gate, update factual
   records, and merge this reviewed branch to `main`.

## Validation

- `pnpm test:local packages/derived/src/instance-label-placement.test.ts packages/edit-engine/src/transaction.test.ts`
- `pnpm typecheck`
- `pnpm format:check`
- `pnpm install --frozen-lockfile`
- `pnpm ci:check`
- required remote GitHub Actions checks after push
- `git diff --check`
- `git status --short --branch`

## Commit Intent

Commit as:

```text
fix(labels): stabilize visual grid clearance on rotation
```

## Outcome

Separated rendered symbol ink bounds from the padded interaction envelope and
made automatic reference labels use the nearest canonical grid line one cell
from ink. Repeated rotations no longer reconstruct or retain a rounded
clearance. A label that still equals the current default is reflowed at that
fixed spacing; a user-positioned, grid-aligned label retains its rigid
object-relative vector and alignment.

Validation passed: focused derived/Edit Engine contracts (52 tests),
typecheck, formatting, `git diff --check`, frozen install, and the complete
isolated-port `pnpm ci:check` gate (728 unit/integration tests, build and
release verification, and 124 browser tests). The first complete browser run
lost its shared port-4173 preview process after test 59; the same full suite
passed on isolated port 4174, confirming a local port-host conflict rather
than a product regression.
