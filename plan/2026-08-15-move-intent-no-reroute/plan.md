---
status: completed
experience: none
---

# Move intent without rerouting

## Goal

Make the editor's existing direct-manipulation routes explicit as a bounded
`MoveIntent` vocabulary, protect ordinary selection from accidental text hits,
and freeze the no-reroute local-stretch boundary with deterministic tests.

## State and Ownership

Start state from `git status --short --branch`:

```text
## codex/unified-move-plan...origin/codex/unified-move-plan
```

The isolated worktree is clean. This target extends the same internal movement
module but does not add persisted state, a public command endpoint, a router,
or a partial-selection toggle whose Engine effects would be incomplete.

- `apps/editor/src/features/selection/selection-move-plan.ts`
- `apps/editor/src/features/selection/selection-move-plan.test.ts`
- `apps/editor/src/app/App.tsx`
- `apps/editor/src/canvas/canvas-hit-resolver.ts`
- `apps/editor/src/canvas/canvas-hit-resolver.test.ts`
- `apps/editor/e2e/manual-editor.spec.ts`
- `packages/derived/src/derived.test.ts`
- `docs/specs/editor-interaction.md`
- `plan/2026-08-15-move-intent-no-reroute/plan.md`
- `plan/log.md`

Read-only shared dependencies: persisted model, Agent API, Edit Engine schema,
Route normalization, and selection reducer. Existing routing planners remain
the mutation authority.

## Work

1. Give the editor-local plan an explicit move/segment/loose-route/rail intent
   vocabulary and use the selection intent for instance-group gestures.
2. Make ordinary hit ranking prefer electrical geometry over labels while
   retaining Alt cycling for deliberate text selection.
3. Add a local-stretch regression proving a boundary move preserves remote
   waypoints and does not invoke global rerouting.
4. Record the no-reroute geometry boundary in the editor interaction contract.
5. Keep direct double-click text editing separate from ordinary move-hit
   priority, with browser coverage for an overlapping route label.

## Validation

- `pnpm test:local apps/editor/src/features/selection/selection-move-plan.test.ts apps/editor/src/canvas/canvas-hit-resolver.test.ts packages/derived/src/derived.test.ts`
- `pnpm typecheck`
- `pnpm format:check`
- `git diff --check`
- `git status --short --branch`

## Commit Intent

Commit as:

```text
refactor(editor): make movement intent explicit
```

## Outcome

Completed the editor-local `SchematicMoveIntent` vocabulary and connected the
existing selection, loose-route, segment, and power-rail gestures to it without
changing persisted or public protocols. Normal hit selection now chooses
electrical geometry before overlapping labels; Alt cycling remains the
deliberate label path. A derived-geometry regression freezes the local stretch
boundary: only the endpoint-adjacent waypoint can change and remote waypoints
are preserved.

Focused validation passed. Mainline validation exposed a text-editing regression
after hit-ranking changed; the repair separates deliberate double-click text
editing from move-hit priority. The repaired full gate passed: 744 unit tests,
127 browser tests, build, release smoke, static checks, and `git diff --check`.
