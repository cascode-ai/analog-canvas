---
status: completed
experience: none
---

# Per-type instance designators and unified camera zoom-box

## Goal

Three related editor interaction fixes agreed with the user:

1. Placement labels increment per device type (R1, R2, M1) instead of one
   global counter (R1, M2, R3).
2. Right-button drag draws a zoom box and fits the camera to it, reusing the
   fit-view math. Zoom/fit/wheel math is first unified behind shared pure
   camera functions (protocol: `(current rect, gesture params, limits) ->
   next rect`); no class hierarchy, per design discussion.
3. Copy (`c`) of components increments the visible label (copy R1 -> R2),
   including batch copy. Pasted instances whose source id equals their
   netlist reference adopt the new reference as their instance id; pasted
   instance-label annotations whose text equals the old id/reference are
   rewritten to the new reference. Custom label text is preserved verbatim.

## State and Ownership

Start state from `git status --short --branch`:

```text
## main...origin/main
```

Worktree clean at branch creation; branch `agent/per-type-designators-zoom-box`
created from `main` before editing.

**Concurrent worker (recorded mid-target):** while this target was in flight,
a second worker started `plan/2026-08-15-unified-schematic-move/` in the same
working tree (selection-move-plan module + selection-controller,
routing-planner, docs/specs edits, and App.tsx wiring for a selection move
plan). Both change sets coexist; no edits were lost. Decision per AGENTS.md:
the two targets share only `App.tsx`, whose hunks are cleanly separable
(one mixed hunk at the DragPreview/BoxPreview interfaces is split manually).
This target proceeds; the commit stages only this target's files and only
this target's `App.tsx` hunks via `git apply --cached`, leaving the other
worker's dirty state exactly as found. Workspace-wide `pnpm typecheck`
currently reports two errors inside the other worker's untracked
`selection-move-plan.test.ts`; they are not caused by this target.

- Owned: `apps/editor/src/app/App.tsx` (this target's hunks only),
  `apps/editor/src/features/netlist-export/netlist-authoring.ts` (+ test),
  `apps/editor/src/features/clipboard/clipboard.ts` (+ test),
  `apps/editor/src/canvas/fit-view.ts` (+ test),
  `apps/editor/src/styles.css`,
  `apps/editor/e2e/manual-editor.spec.ts`,
  `apps/editor/e2e/component-insert.spec.ts`
- Read-only: `packages/symbols/src/netlist.ts` (prefix definitions consumed,
  not changed), `packages/model`, `packages/edit-engine`
- Shared contracts affected: instance id allocation semantics (e2e specs pin
  specific ids — updated deliberately per the new contract); pasted instance
  id format (`R1-copy-1` -> `R2` when source id == source reference).

## Work

1. `netlist-authoring.ts`: add `placementReferencePrefix` (single prefix
   source: GND/port overrides, then device netlist prefix, else `X`),
   `nextInstanceDesignator` (lowest free index per prefix across the union of
   instance ids and netlist references), `netlistReferenceMatchesPlacement`
   (whether id and reference share a prefix so both can use the designator);
   `initialInstanceNetlist` gains an optional reference override.
2. `App.tsx` placement: `placeNewComponent` allocates id via
   `nextInstanceDesignator` and passes it as the netlist reference when
   prefixes match; delete the local prefix table and `instanceCounter`.
   `placeVddRail` scans for the lowest free `VDD{n}` instead of using the
   global counter.
3. `clipboard.ts`: compute new references first, then pasted ids (designator
   `newReference` when source id === source reference and free, else existing
   `-copy-N` fallback); rewrite pasted `instance-label` annotation text when
   it equals the source id or reference. Batch copy stays correct via the
   shared occupied sets.
4. `fit-view.ts`: add `CAMERA_ZOOM_LIMITS` and `zoomCameraAtAnchor` (pure,
   anchor in 0..1 viewport space); migrate `zoomViewAtCenter`, wheel zoom,
   and fit onto them (no behavior change for existing inputs).
5. Right-drag zoom box: `BoxPreview` gains `intent: "select" | "zoom"`;
   button-2 drag from empty canvas starts it, finish commits
   `fitCameraToBounds(rect)` when both extents exceed one grid cell;
   distinct `.zoom-box` style; tool/placement modes keep existing
   right-click cancel behavior.
6. Update pinned e2e assertions for per-type numbering and designator paste
   ids; add e2e coverage for right-drag zoom and unit tests for the new
   pure functions.

## Validation

- `git diff --check`, `git status --short --branch`
- `pnpm test:local apps/editor/src/features/netlist-export/netlist-authoring.test.ts apps/editor/src/features/clipboard/clipboard.test.ts apps/editor/src/canvas/fit-view.test.ts`
- `pnpm test:e2e:local apps/editor/e2e/manual-editor.spec.ts apps/editor/e2e/component-insert.spec.ts`
- Focused checks cover changed behavior; broader suite only if failures
  leak beyond these files.

## Commit Intent

Commit as:

```text
feat(editor): per-type designators, copy label increment, right-drag zoom box
```

## Outcome

Delivered all three requested behaviors on branch
`agent/per-type-designators-zoom-box`:

1. Placement labels now increment per type (`nextInstanceDesignator` scans
   the union of instance ids and netlist references for the lowest free
   per-prefix number; the single prefix source is
   `placementReferencePrefix` with GND/port overrides over device netlist
   prefixes). The global `instanceCounter` and the duplicated inline prefix
   map are gone; `placeVddRail` scans for the lowest free `VDD{n}`.
   When label and netlist prefixes agree the designator is also the netlist
   reference, so label, id, and reference are one fact. Freed numbers are
   reused (undo/reload-safe by construction).
2. Zoom math is unified behind pure camera functions in `fit-view.ts`
   (`zoomCameraAtAnchor` + shared `CAMERA_ZOOM_LIMITS`); center zoom, wheel
   zoom, and the new right-drag zoom box all derive from them, and the box
   commit reuses `fitCameraToBounds` exactly like Fit View. Right-drag from
   empty canvas frames a region (`.zoom-box` preview); sub-grid right drags
   stay ordinary right clicks; drafting/wire right-click cancel behavior is
   unchanged. Camera-only: no revision change.
3. Copy (`c`) increments visible labels: a pasted instance whose source
   id equals its reference adopts the incremented reference as its id
   (copy R1 -> R2; batch R1+R2 -> R3+R4 via shared occupied sets), and its
   instance-label annotation is rebuilt with `semanticTextDocument` so the
   canvas label reads the new reference with correct base/subscript runs.
   Hand-edited labels and diverged ids keep the opaque `-copy-N` fallback.

Validation: 20/20 focused unit tests (netlist-authoring, clipboard,
fit-view); Playwright 17/17 component-insert, 65/65 manual-editor (incl. two
new tests: per-type numbering, right-drag framing), 6/6 crash-safety +
recovery, 25/25 drafting; `git diff --cached --check` clean. Workspace
typecheck passes except two pre-existing errors inside the concurrent
worker's untracked `selection-move-plan.test.ts` (documented above; not from
this target, and not part of the commit). Commit staged only this target's
files plus this target's `App.tsx` hunks; the concurrent worker's dirty
state was left untouched.

status: completed
experience: none
