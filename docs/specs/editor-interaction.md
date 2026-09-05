# Editor Interaction

Status: `accepted`

Primary owner: `apps/editor`

The browser editor is a direct-manipulation client over one current
`SchematicDocument`. Human and Agent mutations enter the same Edit Engine,
revision, validation, undo, rendering, and recovery boundaries.

## Components and interface markers

The insertion UI lists exact reviewed Symbol IDs plus the current Project's
eligible Cell definitions in a dynamic **Cells** section. A Cell selection
uses the same cursor preview, grid snap, rotation, mirror, and cancellation
state as a Symbol; its commit factory alone differs, creating one typed
subcircuit Instance through a Project structural transaction. `Xn` is its sole
Instance Reference and is both displayed and emitted. A separate visible
Cell/master label, when present, is ordinary literal attached text with no
identity or hierarchy authority. Both `port` and
`port-filled` remain manually reachable artwork for one concept: **Cell Pin**.
Terminal `P` participates in ordinary snap, wire, move/stretch, and selection
behavior. Placement atomically creates the Instance, Base Net membership, and
one stable ordered Cell terminal through a Project structural transaction. It
contributes the `.subckt` interface without emitting an instance line. Every
parent block therefore observes a child Cell interface revision without a
later expose step.

Library, the `I` shortcut, and **Place Cell** are entry views over one
editor-local insert controller. Their request is either an `all` picker (the
full component catalog, Cells, and supported external masters), a `cells`
picker, or a quick request for an already chosen Symbol. The controller clears
the previous picker scope before it starts placement, then delegates to the
existing component, Cell, Cell-Pin, external-master, or VDD-rail planner. This is
an editor interaction boundary only: it does not add a persisted project type,
an Edit Engine operation, or an Agent API endpoint.

**Port** and **Filled Port** are hollow and filled visual variants of Cell Pin.
`P`, the Library, and full Insert all enter the same placement planner. An
isolated Pin receives the first unused `Vin`, `Vin2`, … interface name and the
`passive` direction; a named contact or explicit text takes precedence.
Duplicate Port Names are valid. Placement and rename always create or update
only the selected Cell Pin; a matching name never attaches markers, merges
Nets, or synchronizes directions. The bound name is edited in place and its
Razavi RichText projection retains conventional subscripts.

Reusable hierarchy is authored through **New Cell** and **Place Cell**. **Enter
Cell** opens only a selected hierarchical Instance; it never changes a
drafting object.

There is no separate Cell Interface authoring surface. A child Cell Pin shows
only its object-anchored terminal-name annotation in the normal Reference slot;
its stable Instance ID is not drawn and it has no Instance Reference. Normal
Properties own direction. Annotation rename changes only that declaration.
Caller reconciliation compares the formal name projection before and after:
it does nothing while the old-name group survives and never merges caller
Nets when a declaration joins an existing name.
Ordinary Delete reuses the normal instance/route deletion proposal: it retains
wire geometry by replacing affected terminal endpoints with Junctions, then
removes electrical memberships, NoConnects, owned labels, layout references,
and the Instance in one transaction. The formal-terminal and caller projection
is appended only by the Project transaction.

The **Placement Tray** is the only retained-unplaced presentation surface. A
tray item may be dragged, entered into the ordinary placement cursor, or placed
with **Place all** into a deterministic starter grid in the current view.
**Return to tray** and **Return all** use the same lifecycle planner and retain
electrical facts; permanent Delete remains a separate action. Object-anchored
labels are retained with an unplaced Instance but are neither rendered nor
hit-testable until re-placement. Cell Pins use the same return path:
the Cell interface remains present while the Port is retained in the Tray.
Definition-level pin placement data remains compatible, while
new interfaces use deterministic direction-aware automatic layout.

Canonical `nmos`/`pmos` use the asset's `textbook-3terminal` visual variant by
default while retaining D/G/S/B electrically. A manual MOS uses explicit B
membership first, then an explicitly configured cell default; otherwise bulk
remains unresolved. Drawing the visible `bulk-dashed` connection clears that
default binding and connects B to the selected Net in the same transaction.
Imported MOS instances do not receive a guessed fourth node.

## Formula-capable Signal Flow blocks

Integrator (`1/s`), Unit Delay (`z^-1`), and Discrete-Time Integrator
(`z^-1/(1-z^-1)`) are presets of one rectangular Transfer Function presentation
contract; they differ only in the prefilled formula. Transconductance (`+g_m`)
uses the same formula and adaptive-layout contract with a directly witnessed
right-tapered trapezoid. Authors can edit it to textbook forms such as `+g_m1`
or `-g_mL`; `_` and Unicode subscript glyphs render as SVG subscripts. Every
formula glyph uses the same
12-unit size. Fractions stack numerator and denominator without shrinking the
text, and longer content automatically expands the frame and the horizontal
A/Y lead span on the 10-unit grid. Properties edits the formula, optional
coefficient, and optional minimum width/height. Authored dimensions are lower
bounds—content can make the frame larger, never smaller or clipped. The shared
layout also drives route endpoints, hit bounds, backgrounds, previews, and
untouched canonical instance-label placement. These controls are schematic-only
and do not modify SPICE parameters, netlist identity, or electrical pin names.
All formula-capable Signal Flow blocks remain manual-only behavioral elements;
a structural netlist requires an explicit implementation mapping.

Ground is the `ground` component connected through pin `0`; placement reuses an
existing global ground supply Net. Power Rail is a virtual Library item presented
through the same I-dialog, Library, and placement input plane as components.
Its editor-local VDD artwork is preview-only and is not registered with the
product Symbol Resolver. Before the first click the artwork follows the
pointer; after the first click the preview becomes a straight horizontal or
vertical rail, selected by the pointer's dominant axis. The second click
creates a Base Net with the selected global supply claim, creates two route-anchor
Junctions and one `power-rail` Route, and persists one net-name-bound RichText
power-label annotation. Same-name supply claims resolve to one Logical Net
without a physical merge. The Route is the only rail geometry: the annotation adds no
supply bar or terminal stub, and the semantic name uses the shared Razavi
schematic-math style. It creates no VDD Instance and exits placement after the
commit. Deleting the rail also deletes its power label and rail-only Junctions;
an otherwise-unused local Net follows the ordinary orphan lifecycle.

## Project sessions

New, Open, SPICE import, Gallery/My Example open, and recovery restore are
Project-session transitions rather than Document edits. A dirty current Project
always requires an explicit discard or cancel decision before one of these
transitions commits; a successful browser-recovery write is safety evidence,
not authorization to replace the foreground Project. Candidate files and
gallery/recovery payloads are parsed and validated before that decision.

The editor retains one in-memory Previous Project snapshot when a live session
is replaced. **Previous Project** swaps it with the current session through the
same dirty-work guard. This bounded session rollback is deliberately separate
from Document Undo/Redo. Boot-time deep links and an explicit Refresh restore do
not create a Previous Project entry because no live foreground session is being
replaced.

Project dirty detection covers `structureRevision` and every Document revision,
not only the active Cell, and compares the content with the last acknowledged
Cloud baseline so Undo can return to clean. **New Project** creates a new canonical Project with
one empty Main Cell, no SPICE source manifest entries, and no external
subcircuit definitions; it does not mutate the previous Project into an empty
shell. Opening a Cloud Project binds its stable id and revision to the runtime
session; importing a file does not. After a Cloud Save, **Revert to Last Saved**
restores that acknowledged content through the same guard and makes the
outgoing working copy the Previous Project. Export and backup never establish
or advance this baseline.

## Cell reset lifecycle

Cell reset commands are Document transactions and therefore use Document Undo,
not Previous Project. Each command previews an exact affected-object count
before commit:

- **Clear Drawing** removes authored Route geometry and drafting objects while
  retaining Instances, Nets, Junction topology, ports, and semantic
  annotations.
- **Reset Cell Placement** returns every placed Instance to the Placement Tray,
  removes Route geometry and placement constraints/groups, and retains the
  devices, Nets, Junction topology, and formal interface.
- **Reset Cell Body** removes non-interface electrical and drawing content but
  retains formal terminals, their interface Port markers, their Nets, and
  terminal annotations. Existing parent callers therefore keep the same pin
  contract.

**Delete Cell** remains a Project-structure transaction and is legal only for
a non-top Cell with no callers. That precondition is checked by the hierarchy
planner before the transaction is submitted.

## Interaction states

The canonical reducer owns exactly one exclusive canvas interaction:

```text
Idle
  -> SymbolPlacement(preview, rotation)
  -> VddRailPlacement(preview, optional first point)
  -> CopyPlacement(clipboard, anchor, preview)
  -> Wire(source, authoredSteps, routingMode, cornerOrder, preview)
  -> Drawing(tool, source, waypoints, preview, snap)
```

Box selection, selection move, pan, and text-edit sessions remain bounded
gesture owners, but every reset boundary cancels them together with the
canonical interaction. No component preview, rail endpoint, clipboard, authored
Wire step, routing mode, drawing point, or snap guide is stored in a parallel
React mode flag.
Command arbitration reads the reducer's synchronously advanced state, not the
last rendered React closure, so consecutive native events such as `Escape -> C`
observe the first transition even when React batches the next render.

Wire defaults to orthogonal. While Wire is active, a middle-button click
switches only the unresolved leg between orthogonal, 45-degree octilinear, and
any angle (ADR 0039);
a middle-button drag pans as usual. F3 opens Wire options including corner
order. Existing authored legs are immutable under mode switches; Backspace
removes the latest authored step rather than an automatically compiled elbow.

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

Frame-zoom is one camera gesture with two entry buttons: right-drag from
empty canvas, or Alt+left-drag for environments where system software
(screenshot tools, mouse-driver gestures) hooks the right button before the
browser receives the drag. A webpage cannot block system-level mouse hooks,
so the Alt alias is the portable entry. Both draw the same transient frame
preview and fit the camera to the framed region without touching the
Document revision; a press that never exceeded one grid cell stays an
ordinary click.

Escape cancels the active preview without mutation. A committed gesture is one
atomic transaction. Hover, geometric crossing, selection, and preview never
change connectivity. A wire endpoint or explicit segment tap is required to
create contact.

## Movement closure

Every direct-manipulation selection move first derives one transient stable-ID
routing closure. The editor keeps only gesture state; the Edit Engine's
`planRoutingTransform()` is the shared authority for the semantic preview and
the typed edits committed on pointer release. Neither object is Project data or
an Agent API payload, and no pointer handler invents an independent follow set.

Schematic movement follows the Virtuoso pairing. Plain `M` translates the
selection while internal conductors follow and boundary Routes stretch without
changing connectivity. `Shift+M` (and its Ctrl/Cmd-drag direct gesture) moves
the selected Instances without their wires: every routed terminal is first
replaced by an open Junction stub at the original landing, then the existing
`disconnect_endpoint` edit removes that terminal from the old Base Net. The
wire geometry remains byte-for-byte in place and the moved pin is electrically
open. Both gestures use the same selection-move controller and existing typed
edits; detached move is not a persisted mode or a second mutation protocol.

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

The same boundary applies to `C` and Delete. `C` remains the existing modal
copy-placement gesture (not Ctrl+C/Paste): its preview and commit use one
preallocated clone mapping, internal routing is copied, and ordinary boundary
pins are left open. Delete converts the complete visual selection to one graph
deletion plan, so Route/Junction/attachment cleanup does not require a second
Delete press. Formal Cell Pins retain their Project-level interface update,
but its Document edits come from that same deletion plan.

A copied Cell Pin always receives a fresh Instance and terminal identity. Its
name and direction are preserved; an equal name is legal and affects only the
read-only Formal Port projection. Copying a completely selected physical Net
may clone that Net and its internal Routes. A selection boundary never creates
shared identity from text and never guesses a new electrical connection.

The planner authors the resulting geometry for every planned Route in the
same transaction. Engine instance-follow remains the safe single-instance
fallback, not a second progressive planner for a group gesture. Marquee Route
selection tests actual polyline segments against the rectangle, rather than
selecting a distant bend solely because its bounding box overlaps the gesture.

The marquee is directional, following the classic drafting-tool pairing. A
left-to-right drag is a window: an object joins the selection only when its
geometry is fully contained (an outline rectangle needs all four corners; a
Route needs its whole centerline). A right-to-left drag is a crossing: any
geometric overlap selects, which preserves the previous behavior. A Junction
is its point in both directions. The live preview distinguishes the modes
(solid window, dashed crossing). Membership is decided by document geometry
alone: the canvas suppresses native browser text selection, so a drag can
never highlight or select labels outside the dragged rectangle.

## Selection alignment

The six visual alignment commands — left, horizontal center, right, top,
vertical center, and bottom — share one editor command and one alignment
planner. The Edit menu and the shared canvas context menu are presentation
surfaces for that same command; neither owns a separate alignment behavior.

Instances, schematic annotation text, and DraftText use the same click
selection entry point: a plain click replaces the selection, while
`Shift`/`Ctrl`-click toggles that object without discarding other selected
kinds. Right-clicking an already-selected one preserves the complete mixed
selection and opens the shared context menu; right-clicking an unselected one
selects it first. Device-swap choices appear only when the complete selection
contains exactly one Instance.

Placed Instances, explicitly selected schematic annotations, and explicitly
selected free or object-anchored DraftText are eligible participants. An
object-anchored label selected together with its host Instance is a follower,
not a second participant, so it moves exactly once with the host. Routes,
Junctions, and other drafting shapes are not alignment participants. Instance
movement expands to ordinary `move_instance` edits, while text expands to the
same annotation or drafting-object edit used by direct text movement. The
complete alignment commits as one transaction and therefore one Undo step.
The legacy `align_instances` typed edit remains a compatibility boundary for
external callers; the GUI does not call it.

## No-reroute movement boundary

The editor's finite direct-manipulation vocabulary is transient only:
`move-selection`, `stretch-segment`, `move-loose-route`, `move-power-rail`,
the two ordinary Route endpoint resizes, and the two explicit power-rail
endpoint resizes. It is not Project data, an Edit Engine command, or an Agent
API extension; each intent compiles to the existing typed edits. Both ends of
an ordinary Route offer a resize grip, including one anchored to a pin.

No movement intent searches for a new path. An internal Route translates every
point by one common delta. A boundary stretch may alter only geometry adjacent
to the moved endpoint (or add one local orthogonal elbow); remote waypoints
remain untouched. A protected adjacent `locked` or `trunk` segment rejects the
gesture rather than being rerouted. Power rails use their explicit translate
and endpoint-resize intents, never an inferred route search. Endpoint resize is
limited to the rail's current axis. Whole-rail translation includes its tap
Junctions and incident geometry, so a connected rail does not fragment.

Normal canvas hit ranking prefers a symbol, Route, or Junction over an
overlapping label so routine moves do not accidentally drag text. Text remains
individually selectable when it is the only hit, and Alt cycling deliberately
selects an overlapping label. A deliberate double-click is an editing intent,
not a movement intent: it resolves an overlapping editable annotation directly
without requiring an Alt cycle.

## Text and presentation

Every visible editable label is one persisted RichText annotation. Component
insertion uses one default-display policy: ordinary instances receive an
`instance-reference` label, which projects only `Instance.reference`.
Internal Cells and external subcircuits additionally receive their
Cell/master presentation as attached literal text; a Cell Pin receives only an object-anchored
`cell-terminal-name`; and parameter values use `instance-value` when requested
and displayable.
Properties and character editing of the bound canvas label both rename the one
Instance Reference. Same-text RichText formatting stays in the Annotation and
ordinary attached literal text never becomes a Reference.
A character edit whose text the component's Reference prefix policy refuses
(`gm` on a resistor, whose Reference the netlist prints as `R…`) is not
committed as a rename and does not end in the Edit Engine's refusal: the
editor offers to keep the Reference and show the typed text as attached
literal text in the label's place. Accepting hides the `instance-reference`
projection (`visible: false`), creates one literal `instance-label` Annotation
at the same anchor with the edited size, alignment, and colour, and leaves
`Instance.reference` unchanged; declining keeps the editor open. Properties
exposes the same attached text as a `Label` field for every placed component,
including one with no Reference at all: setting it creates or rewrites the one
literal `instance-label` Annotation of that Instance — in the hidden Reference
projection's place, otherwise on the next free label line below the Reference
and a shown value — and clearing it removes that Annotation. Neither direction
touches the Reference, the netlist, or export.
For a Cell Pin, a character edit renames the terminal while a formatting-only
edit persists a same-text annotation `formatOverride`. Properties exposes the
Cell Pin name and direction. Net naming remains a Net Label operation.
The renderer never synthesizes text from Instance IDs and no empty suppressor
label exists. Reference label display is a Properties toggle for one or many
selected components: hiding sets the annotation's optional `visible: false`
flag, which renderers and hit/marquee surfaces skip while the annotation stays
in the Project, so hiding is recoverable and a missing label can be re-created
from the same toggle. Component value display is the paired `Value` toggle on
the same control row: MOS devices project `W/L` as a stacked fraction with a
fraction bar, passives and independent sources project their scalar parameter,
and every projected value is upright bold text carrying its engineering unit
(`150n` displays as `150nm`, `10k` as `10kΩ`). The toggle's availability
follows the live property draft — typing a value enables it without
reopening the panel — and checking it commits the typed parameters and shows
the projected value in one transaction. Showing a value re-projects its text
without touching electrical parameters or a user-dragged anchor; the Edit
Engine refreshes a non-hand-edited value after parameter edits. Net/power
labels carry Net identity separately from their
visual anchor. A resolved anchor drives both the glyph and every text
hit/marquee surface; its fallback is only for an orphaned target, never an
editor-local alternate position. Dragging a route-anchored Net label re-anchors
it along its own Route (segment, t, and a generous normal-offset band) instead
of moving a fallback position. Selecting a `power-rail` together with its power
label is one visual deletion: the label removal is planned once, so the atomic
transaction cannot reject a duplicated annotation removal. Drafting text has
no electrical meaning.

Selecting an Annotation exposes its own Text color control. Auto removes only
that Annotation's `textColor`; instance reference/value text then inherits the
owning Instance's effective foreground, while other annotations use the
Document profile foreground. Selecting drafting text exposes its independent
drafting color override, whose Auto state uses the Document profile foreground.
Both controls transact through their owning object and preserve unrelated
style fields, selection, and electrical content.

The floating RichText editor has one formula action for editable text content.
It opens a MathLive math field plus the exact LaTeX source, lets the author
choose inline or display intent, validates against the bounded Analog Canvas
math profile, and replaces the current RichText document with one atomic
formula only after validation succeeds. Ordinary bold, italic, script,
overbar, alignment, multiline, and symbol controls remain the same RichText
system; formulas do not create an Additional Text or Annotation side channel.
For a semantic name binding, Formula Insert checks the proposed formula before
it changes the editing session. A bounded formula made only from groups,
scripts, overbar, bold/italic wrappers, and supported Greek symbols is compiled
to the same canonical RichText presentation when its flattened characters
still equal the bound name. A non-equivalent Instance Reference formula offers to become a
literal formula annotation attached at the Instance's value-label position;
accepting keeps `Instance.reference` unchanged. Declining leaves the Formula
editor open. Other bound electrical names refuse a non-equivalent formula in
the Formula panel. Ordinary character edits and formatting commands do not use
this formula-only decision path.

## Files, recovery, and replacement

Open, demo load, restore, and human-approved staged import replace the entire
Project through one replacement boundary; they are not Edit Engine
transactions. Replacement cancels pending recovery for the outgoing Project
and terminates its Agent session. A complete Project covered by the schema
24→38 upgrade chain may be upgraded at the read boundary and then enters the
editor only as schema-38; migrated files are marked as needing save.

Selection, viewport, active tool, previews, Agent tokens, and approval UI are
transient and never enter Project JSON. Recovery is scheduled only after a
successful transaction or explicit replacement and stores no bearer token.

The Project-name area shows a small unsaved marker derived from the same file
lifecycle that controls Save. While that marker is present, browser Back,
Refresh, and tab/window close use the browser-native leave confirmation;
ordinary in-app navigation, selection, zoom, and panel changes do not affect
it. New, Open, Revert, recovery restore, and approved staged replacement use
one concise application dialog with Stay, Save to Cloud and continue, and
Continue without saving. The dialog states the destination and distinguishes
Cloud Save (at most three private Cloud Projects) from local Project-file
export without exposing browser-recovery internals. A startup recovery offer is
a non-modal overlay and never silently
replaces the active Project.

Same-site destinations owned by the product, including Gallery and Analytics,
enter through this application replacement guard. Their anchors retain normal
link behavior for modified clicks, but an ordinary primary click must not fall
through to a second native `beforeunload` prompt.

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
- component placement and ordinary terminal connectivity for both
  interface-marker assets;
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
