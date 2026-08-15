# Editor Interaction

Status: `accepted`

Primary owner: `apps/editor`

The browser editor is a direct-manipulation client over one current
`SchematicDocument`. Human and Agent mutations enter the same Edit Engine,
revision, validation, undo, rendering, and recovery boundaries.

## Components and Ports

The insertion UI lists only exact reviewed Symbol IDs. Both `port` and
`port-filled` remain ordinary manually reachable components. Choosing either
starts the same placement state as any component; terminal `P` participates in
ordinary snap, wire, move/stretch, selection, clipboard, and delete behavior.
No canvas interaction creates a first-class Port object.

Canonical `nmos`/`pmos` use the asset's `textbook-3terminal` visual variant by
default while retaining D/G/S/B electrically. A manual MOS uses explicit B
membership first, then a configured cell default, then the canonical supply
default: NMOS bulk uses/creates global ground and PMOS bulk uses/creates global
VDD. Drawing the visible `bulk-dashed` connection clears that implicit binding
and connects B to the selected Net in the same transaction. Imported MOS
instances do not receive a guessed fourth node.

Ground is the `ground` component connected through pin `0`; placement reuses an
existing global ground supply Net. VDD Rail is a virtual Library item presented
through the same I-dialog, Library, and placement input plane as components.
Its editor-local VDD artwork is preview-only and is not registered with the
product Symbol Resolver. Before the first click the artwork follows the
pointer; after the first click the preview becomes the horizontal rail. The
second click creates/reuses an explicit global VDD Net, creates two route-anchor
Junctions and one `power-rail` Route, and persists one RichText power-label
annotation. The Route is the only rail geometry: the annotation adds no supply
bar or terminal stub, and its complete `V_DD` text is bold italic with `DD` as
a subscript. It creates no VDD Instance and exits placement after the commit.
Deleting the rail also deletes its power label and rail-only Junctions while
preserving a VDD Net still used elsewhere.

## Interaction states

The canonical reducer owns exactly one exclusive canvas interaction:

```text
Idle
  -> SymbolPlacement(preview, rotation)
  -> VddRailPlacement(preview, optional first point)
  -> CopyPlacement(clipboard, anchor, preview)
  -> Wire(source, waypoints, preview)
  -> Drawing(tool, source, waypoints, preview, snap)
```

Box selection, selection move, pan, and text-edit sessions remain bounded
gesture owners, but every reset boundary cancels them together with the
canonical interaction. No component preview, rail endpoint, clipboard, Wire
waypoint, drawing point, or snap guide is stored in a parallel React mode flag.
Command arbitration reads the reducer's synchronously advanced state, not the
last rendered React closure, so consecutive native events such as `Escape -> C`
observe the first transition even when React batches the next render.

Activating the same tool is idempotent: repeated C, W, A, K, or selection of the
same Library item preserves the active session. Activating a different creation
tool replaces the current interaction atomically after drag and snap cleanup.
During component or Copy Placement, `R` quarter-turns the transient preview;
`Shift+R` mirrors it left/right and `Shift+V` mirrors it top/bottom. Every
subsequent committed copy receives the same transient orientation, while the
source selection remains unchanged. The background grid-dot button changes
only the editor-local canvas paint. Instance reference labels use the first active Document grid line one interval beyond
the drawn symbol ink. The padded interaction envelope never contributes to
that clearance, and placement uses nearest-grid normalization for calibrated
finite-decimal ink edges rather than directional outward snapping. A quarter
turn reflows a canonical label from its local side at that fixed spacing; four
quarter turns return its position and alignment to the initial values. Opening
I cancels the current canvas interaction before showing the dialog.
Escape, Document switch, Project replacement, Clear Canvas, restore, and Agent
focus reset all use the same transient-cancellation boundary.

Shortcut arbitration is centralized. Escape, viewport pan/zoom, same-tool
re-entry, and explicit creation-tool switches are valid while an interaction
owns the canvas. Selection-dependent commands such as Copy, Delete, Q, L,
rotate, mirror, and marker editing cannot act on a stale selection underneath
another active interaction. Undo/Redo may mutate the Document and therefore
cancel a snapshot-dependent active interaction. Shortcut key assignments are
independent of this state policy and remain unchanged.

## Coordinate normalization

Pointer and drag previews may retain finite float positions. Before an editor
gesture creates or changes a Project point, it explicitly snaps to the active
Document grid; preview or SVG geometry is never committed directly. Camera is
also grid-aligned: Fit expands derived visual bounds outward to the grid, and
zoom, pan, focus, Document activation, replacement, and Agent semantic focus
all pass through the same camera normalizer. The viewport remains transient,
but it cannot carry derived float bounds into the renderer's integer grid
camera contract.

Escape cancels the active preview without mutation. A committed gesture is one
atomic transaction. Hover, geometric crossing, selection, and preview never
change connectivity. A wire endpoint or explicit segment tap is required to
create contact.

## Movement closure

Every direct-manipulation selection move first derives one transient,
editor-only `SelectionMovePlan`. It is neither Project data nor an Edit Engine
or Agent API payload. The plan is the shared authority for the live preview and
the typed edits committed on pointer release; no pointer handler may invent an
independent follow set.

The visual marquee is the user's explicit intent. Electrical closure then
classifies that intent without changing connectivity:

- selected Instances translate together;
- a Route/Junction component whose terminal endpoints are all selected is
  internal and translates intact;
- a Route with exactly one selected Instance endpoint is a boundary Route and
  is stretched while preserving its external endpoint;
- an explicitly selected loose Route may translate only together with both of
  its loose Junction anchors;
- an ordinary connected Route or Junction that does not meet one of those
  conditions is fixed for a group move. It is edited through the explicit
  segment/branch tools, never silently detached or reconnected;
- object- and route-anchored annotations follow their resolved target; free
  annotations and free drafting objects translate only when explicitly
  selected.

The planner authors the resulting geometry for every planned Route in the
same transaction. Engine instance-follow remains the safe single-instance
fallback, not a second progressive planner for a group gesture. Marquee Route
selection tests actual polyline segments against the rectangle, rather than
selecting a distant bend solely because its bounding box overlaps the gesture.

## Text and presentation

Every visible editable label is one persisted RichText annotation. Component
insertion creates an `instance-label` only when reference display is requested.
The renderer never synthesizes text from Instance IDs and no empty suppressor
label exists. Net/power labels carry Net identity separately from their visual
anchor. A resolved anchor drives both the glyph and every text hit/marquee
surface; its fallback is only for an orphaned target, never an editor-local
alternate position. Selecting a `power-rail` together with its power label is
one visual deletion: the label removal is planned once, so the atomic
transaction cannot reject a duplicated annotation removal. Drafting text has
no electrical meaning.

## Files, recovery, and replacement

Open, demo load, restore, and human-approved staged import replace the entire
Project through one replacement boundary; they are not Edit Engine
transactions. Replacement cancels pending recovery for the outgoing Project
and terminates its Agent session. Only complete schema-9 Projects are accepted;
the editor performs no migration.

Selection, viewport, active tool, previews, Agent tokens, and approval UI are
transient and never enter Project JSON. Recovery is scheduled only after a
successful transaction or explicit replacement and stores no bearer token.

## Agent semantic control

API 2.0 may advertise optional `semanticControl` for transient review focus:
select a canonical locator, highlight a Net, activate/fit an existing Cell, or
clear focus. It cannot send pointer events, keystrokes, CSS, selectors, DOM
queries, or arbitrary zoom matrices. Semantic control never changes revision,
topology hash, history, recovery, or formal export.

## Deterministic validation

- state-transition, shortcut focus-guard, and command-by-interaction matrix
  tests, including repeated C/W/A/K, I/Escape/re-entry, and render-free
  `Escape -> C` bursts after NMOS, PMOS, and passive placement;
- component placement and ordinary terminal connectivity for both Port assets;
- VDD rail picker/Library preview, cancellation at both phases, creation with no
  VDD Instance or annotation-owned stub, bold italic subscript label, default
  exit, selection, and complete visual deletion;
- canonical MOS default-variant and explicit bulk behavior;
- move/stretch, segment tap, crossing non-connectivity, cancel, delete, and
  undo/redo tests;
- annotation-only label rendering with no duplicates;
- GUI/Agent transaction parity;
- Playwright flows for insertion, wiring, transformation, save/reopen, staged
  candidate isolation, human replacement approval, and formal export.
