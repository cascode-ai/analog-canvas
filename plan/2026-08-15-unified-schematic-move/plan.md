---
status: completed
experience: none
---

# Unified schematic move plan

## Goal

Replace the editor's divergent instance-group drag closure with one pure,
topology-aware movement plan. A marquee selection may contain instances,
Routes, Junctions, annotations, and drafting objects; the same plan must drive
its preview and its one atomic typed-edit commit without changing persisted
Project schema or the Agent API.

## State and Ownership

Start state from `git status --short --branch`:

```text
## main...origin/main
```

The source worktree was clean. This target is on
`codex/unified-move-plan`, created directly from current `main`.

- `packages/edit-engine/src/routing-planner.ts`
- `packages/edit-engine/src/routing.test.ts`
- `apps/editor/src/app/App.tsx`
- `apps/editor/src/features/selection/selection-controller.ts`
- `apps/editor/src/features/selection/selection-controller.test.ts`
- `docs/specs/editor-interaction.md`
- `docs/specs/edit-engine.md`
- `plan/2026-08-15-unified-schematic-move/plan.md`
- `plan/log.md`

Read-only shared dependencies: `packages/model` schema, Agent adapter schema,
resolved route geometry, Symbol Resolver, and browser test harness. No
persisted model or Agent contract changes are authorized in this target.

## Work

1. Add a pure editor-local `SelectionMovePlan` that classifies explicit visual
   roots into whole-object translation, safe internal Route/Junction
   translation, boundary Route stretching, dynamic anchored following,
   explicit free visual translation, and fixed unsafe geometry.
2. Make group route edits authoritative for every planned Route rather than
   relying on progressive per-instance Engine route following.
3. Route mixed marquee drags through the plan, retain route segment editing as
   a distinct explicit operation, and make modifier selection preserve a mixed
   visual selection.
4. Make marquee Route selection test actual polyline/rectangle intersection,
   not only its bounding box; retain current crossing-style selection behavior
   for this bounded change.
5. Make preview consume the plan's visual closure, including object- and
   route-anchored annotations plus explicitly selected drafting/free objects.
6. Document the internal-only movement contract and add focused regression
   coverage for internal group translation, boundary stretch, mixed selection,
   and unsafe Junction movement.

## Validation

- `pnpm test:local apps/editor/src/features/selection/selection-move-plan.test.ts apps/editor/src/features/selection/selection-controller.test.ts packages/edit-engine/src/routing.test.ts`
- `pnpm test:e2e:local apps/editor/e2e/manual-editor.spec.ts --grep "moves internal wiring with a selected group|keeps an internal junction with the live group preview"`
- `pnpm --filter @icm/editor build`
- `pnpm format:check`
- `git diff --check`
- `git status --short --branch`

## Commit Intent

Commit as:

```text
refactor(editor): unify topology-aware movement
```

## Outcome

Implemented an editor-local `SelectionMovePlan` that supplies one visual
closure for mixed component drags: internal Route/Junction components and
their anchored annotations translate together, explicitly selected free text
and drafting records move by the same delta, and explicitly selected loose
Routes move only with their loose endpoint Junctions. Connected non-loose
Route/Junction roots remain fixed rather than being silently detached.

Group movement now authors every planned Route geometry in the same
transaction, so the Engine does not progressively re-stretch internal wiring
per instance. Additive instance selection preserves an existing mixed marquee,
and marquee Route selection now tests actual segments instead of only bounds.

Validation passed: workspace build, `pnpm typecheck`, focused unit tests
(36/36), focused Playwright group-move coverage (2/2), Prettier, Markdown-link
validation, and `git diff --check`.
