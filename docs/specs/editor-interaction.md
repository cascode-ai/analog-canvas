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
subcircuit Instance through a Project structural transaction. `Xn` remains its
sole Netlist Reference and is emitted, but an internal Cell shows only its
Cell/master name in the normal Reference slot by default. That attached text
has no identity or hierarchy authority. Both `port` and
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
its stable Instance ID is not drawn and it has no Instance Reference. Its
interface direction is managed in Cell Manager. Annotation rename changes only
that declaration.
Caller reconciliation compares the formal name projection before and after:
it does nothing while the old-name group survives and never merges caller
Nets when a declaration joins an existing name.
Ordinary Delete reuses the normal instance/route deletion proposal: it retains
wire geometry by replacing affected terminal endpoints with Junctions, then
removes electrical memberships, NoConnects, owned labels, layout references,
and the Instance in one transaction. The formal-terminal and caller projection
is appended only by the Project transaction.

## Component property code

Selecting a component and opening **Properties** presents its instance
properties together as strict, editable JSON. For example, a resistor:

```json
{
  "placement": {
    "coordinate": [360, 240],
    "rotation": 90,
    "mirror": "none"
  },
  "appearance": {
    "color": "auto"
  },
  "display": {
    "visualAnnotation": true,
    "value": false
  },
  "displayName": "R1",
  "parameters": { "value": "10k", "tc": "0.1" },
  "netlistName": "R1",
  "netlistTarget": ""
}
```

`displayName` is the visual instance annotation and can differ from the
electrical `netlistName` used by netlist export;
`display.visualAnnotation` only controls whether its drawing annotation is
visible. `placement.coordinate` is the `[x, y]` grid coordinate, rotation is restricted to
45-degree steps, and mirror is `"none"`, `"horizontal"`, `"vertical"`, or
`"both"`. Enter confirms the current JSON without inserting a line break;
Shift+Enter inserts one. Display keys appear only for
annotations supported by that Symbol; when present, the `display` object is
kept with placement and appearance near the top. Newly placed Resistor,
Capacitor, and Inductor devices, including their
adjustable variants, author `1k`, `1p`, and `1n` as their initial netlist
values. T-coil starts with `L1=1n`, `L2=1n`, `K=1`, and `CB=1p`; XFMR starts
with `Lp=1n`, `Ls=1n`, and `K=1`. These compound-device parameters remain
authoring values until an explicit structural lowering contract is added.
Transformer and T-Coil Properties expose independent switches under
`display.parameters`: K and each winding inductance (plus CB for T-Coil).
Each switch controls one live value label. Editing a parameter updates its
label; clearing the value hides it. Visibility changes are undoable, and
re-enabling a label preserves its authored position. Untouched labels stack
outside the symbol and remain upright through rotation and mirroring.

Fixed colors are displayed as compact
`[R, G, B]` tuples with integer channels 0–255; six-digit hex input remains
accepted and persisted instance colors remain hex. Four direct line-color
controls provide light gray, red, green, and blue, while three bounded RGB
inputs allow any custom value. `"auto"` inherits global foreground ink;
component background editing is not exposed. Historical background overrides
remain readable so old Projects do not fail to open, and the next accepted
Appearance edit retires that field. Applying valid code plans the existing typed placement,
annotation, parameter, identity, and style edits as one transaction. Unknown
root keys and invalid values are rejected without changing the Document.
`parameters` contains descriptor-owned values and arbitrary model/dialect
overrides as raw strings; empty values or removed keys unset a parameter.
`netlistTarget` accepts model names, including reviewed external targets, and
an empty string clears it. Its JSON value carries a compact inline selector
populated from reviewed targets while preserving authored custom values. A
target switch composes the existing structural
planner with the rest of the draft into one project transaction. No new
project format or parallel netlist authority is introduced.

The optional `symbol` enum exposes only the existing pin-compatible input,
output, or switch-contact variants. `signalFlow` owns formula presentation
overrides. Setting `placement` to null uses the retained-instance unplacement
planner; coordinates re-place the retained instance. Electrical connectivity
and Cell-level interface/layout operations retain their existing typed
authoring surfaces; removing a component remains an explicit Delete action.

The lazy JSON editor provides syntax highlighting, bracket matching, JSON
diagnostics and local text undo. Its document remains ordinary selectable raw
JSON. Descriptor-owned parameter values show their declared unit as a non-data
line annotation, and `netlistTarget` carries a compact non-data selector.
Canvas-layer field metadata still owns
validation of rotation, mirror, color channels, and other bounded values. A
small, non-text switch is visually decorated after each `display.visualAnnotation` and
`display.value` boolean, as well as each `display.parameters` entry, for immediate
visibility toggling. Compact action
buttons after `placement.rotation` and `placement.mirror` rotate clockwise by
90 degrees and reflect left/right or top/bottom. Direct JSON editing continues
to accept all eight 45-degree orientations. Horizontal
and vertical reflection are persisted independently; mirror actions never
rewrite `placement.rotation`, and applying both records `"both"`. A matching color
button after `appearance.color` opens an anchored chooser for light gray,
red, green, blue, black, and one compact bounded RGB tuple input. `"auto"`
remains available through direct JSON editing. These controls never enter the
document, so selection, Copy JSON, and saving contain only authored JSON. Their
changes edit the same draft as typing and valid edits transact immediately
through the existing planner. Invalid syntax or values disable the controls
until the code is valid again.
Component code exposes no background or fill field. Shape code uses
`appearance.fillColor` only for objects with an independently fillable body,
such as rectangles and circles.
Invalid or rejected drafts preserve the last accepted canvas state. External
undo/redo synchronizes the editor without replaying edits; Escape blurs this
editor without applying legacy form drafts or discarding incomplete text.
**Discard draft** restores the last accepted state when
the draft is invalid or rejected, without changing the circuit.
**Defaults** loads known parameter, orientation, color, and formula defaults
immediately and remains undoable; it preserves coordinates, netlist name, model
target, display flags, and unknown overrides. Defaults sits in the Properties
header with Copy and conditional Discard; there is no Apply button.
**Copy JSON** copies
the complete raw draft from the copy icon at the editor's
top right, including unapplied whitespace and invalid drafts. The text area
expands fully without its own scrollbar; only the surrounding panel scrolls.
Instance identity stays in the dock
header rather than being repeated around the code. Switching components cannot carry
an old draft or its local history into a new selection.

The old component placement, display, and appearance button grids are not
mounted in the composed Properties dock. Parameters, Netlist Overrides,
Actions, and Netlist Target no longer have duplicate forms below the JSON.
Specialized electrical terminal and Cell interface/layout controls retain
their distinct connectivity/definition ownership. The left edge of
Properties is draggable and keyboard-adjustable in both docked and compact
overlay layouts; its independent width is retained locally without becoming
Project data.

Rectangle and circle Properties expose independent **Border** and **Fill**
colors. Removing Fill restores a transparent interior. **Bring to front** moves
the shape to the foreground drafting plane above circuit and annotation
artwork; **Send to back** moves it behind circuit artwork. Both are undoable
document edits. Filled foreground interiors remain selectable, while a
background shape uses its border as the hit target so it cannot block circuit
editing above it.

A schematic is what it shows. Every Instance a Cell carries is drawn: SPICE
import lays its devices and Cell Pins out on a deterministic shelf rather than
staging them off-sheet, and opening a Project draws any Instance a legacy
Document still hides, with the same default designator and value projections an
ordinary placement writes. No editor command takes a drawn device off the sheet
— the component property code refuses a null `placement`, and permanent Delete
remains the way to remove a device with its electrical facts.

The **Placement Tray** is the repair surface for the Instances that can still
reach a session without a placement (an older in-session document, an Agent
`unplace`/`reset-placement` edit). An Instance no surface lists is one nobody
can place or delete while it still holds its reference, its Net terminals and
its netlist cards, so the tray lists them, the Check Report counts them
(`ERC_INSTANCE_NOT_DRAWN`), and it disappears once the drawing shows
everything. A tray item may be dragged, entered into the ordinary placement
cursor, or placed with **Place all** into a deterministic starter grid in the
current view. Object-anchored labels are retained with an unplaced Instance but
are neither rendered nor hit-testable until placement. Definition-level pin
placement data remains compatible, while new interfaces use deterministic
direction-aware automatic layout.

Canonical `nmos`/`pmos` use the asset's `textbook-3terminal` visual variant by
default while retaining D/G/S/B electrically. A manual MOS uses explicit B
membership first, then an explicitly configured cell default; otherwise bulk
remains unresolved in the authored connectivity graph. Strict netlist and
simulation extraction use actual B membership or explicit NoConnect; otherwise
they report `MISSING_PIN_NET`, without a polarity-based supply default. User-facing
export and simulation follow the same connectivity rule and do not repair missing Bulk.
Drawing the visible `bulk-dashed` connection
clears any configured default binding and connects B to the selected Net in the
same transaction. Imported MOS instances retain their authored fourth node;
when it is absent, the same missing-terminal rule applies.
Properties shows Bulk as one compact row: its current Net or an explicit
Unconnected/No Connect state sits beside the draw action. Hovering the status
reveals the terminal and binding source; a drawn route's dashed presentation
is described there too. A visible bulk route inherits its owning MOS instance's
foreground color instead of carrying independent wire styling. Selecting that
route identifies it as `Bulk · <instance>` and offers only the bulk-specific
delete action, rather than the generic wire color, label, and arrow controls.
Unresolved bulk is not repeated as a second message.
Drawing is disabled for retained-unplaced instances until they are placed.

## Formula-capable behavioral blocks

Integrator (`1/s`), Unit Delay (`z^-1`), and Discrete-Time Integrator
(`z^-1/(1-z^-1)`) are presets of one rectangular Transfer Function presentation
contract; they differ only in the prefilled formula. The Analog Blocks library
also provides single-input and differential Transconductance (`g_m`) forms.
The single-input form uses the same adaptive-layout contract with a directly
witnessed right-tapered trapezoid; the differential form keeps two fixed input
anchors and one output anchor. Authors can edit either to textbook forms such as
`g_m1` or `-g_mL`; `_` and Unicode subscript glyphs render as SVG subscripts.
Every formula glyph uses the same 12-unit size. Fractions stack numerator and
denominator without shrinking the text. For adaptive forms, longer content
automatically expands the frame and horizontal lead span on the 10-unit grid;
authored dimensions are lower bounds, never clipping constraints. That shared
layout also drives route endpoints, hit bounds, backgrounds, previews, and
untouched canonical instance-label placement. Properties always edits the
formula and optional coefficient, and offers minimum width/height only when the
Symbol declares an adaptive frame. These controls are schematic-only and do not
modify SPICE parameters, netlist identity, or electrical pin names. All such
behavioral blocks remain manual-only; a structural netlist requires an explicit
implementation mapping.

Ground is the `ground` component connected through pin `0`; placement reuses an
existing global ground supply Net. VDD Power is placed as a local formal Cell
Pin by default; Properties can switch its unchanged artwork and physical Net to
an explicit Global declaration. Power Rail is a virtual Library item presented
through the same I-dialog, Library, and placement input plane as components. A
new local Power Rail authors a formal Cell Pin directly from its visible rail
label; no hidden interface Instance or exporter-generated Pin is introduced.
Its editor-local VDD artwork is preview-only and is not registered with the
product Symbol Resolver. Before the first click the artwork follows the
pointer; after the first click the preview becomes a straight horizontal or
vertical rail, selected by the pointer's dominant axis. The second click
creates a Base Net with the selected local supply claim, creates two route-anchor
Junctions and one `power-rail` Route, persists one net-name-bound RichText
power-label annotation, and makes that annotation the formal terminal owner.
Same-name supply claims resolve to one Logical Net
without a physical merge. The Route is the only rail geometry: the annotation adds no
supply bar or terminal stub, and the semantic name uses the shared Razavi
schematic-math style. It creates no VDD Instance and exits placement after the
commit. A rail explicitly drawn onto an existing Global supply retains that
electrical connection. Deleting the rail also deletes its power label and rail-only Junctions;
an otherwise-unused local Net follows the ordinary orphan lifecycle.

## Interaction states

The canonical reducer owns exactly one exclusive canvas interaction:

```text
Idle
  -> SymbolPlacement(preview, rotation)
  -> VddRailPlacement(preview, optional first point)
  -> CopyPlacement(clipboard, anchor, preview)
  -> SelectionMove(M/Shift+M command move)
  -> Wire(source, authoredSteps, routingMode, cornerOrder, preview)
  -> Drawing(tool, source, waypoints, preview, snap)
```

`T` and the Text toolbar action enter drafting-text placement through the same
placement state as components. A translucent text preview starts at the last
canvas pointer position and follows the pointer on the annotation grid. Clicking
commits one free text object at that preview position and opens its text editor.
Before that click, neither the document nor undo history changes; Escape or
choosing another tool discards the preview. Fixed catalog text presets keep their
existing placement behavior.

Drawn objects place on the annotation pitch (1, 5 or 10; Canvas settings, 5 by
default), which is deliberately free of the Document's electrical grid so a
label or an arrow head can sit where it is wanted. A rectangle is the
exception: its corners, moves and handle drags round to the Document's
electrical grid. A rectangle is the shape people draw as a block outline and
then wire to, and a wire endpoint can only land on the electrical grid — an
edge half a cell away from it cannot be met at all, leaving a visible stub of
wire inside the outline.

`M` and `Shift+M` enter SelectionMove, which previews at the pointer and
commits on one click. Box selection, pointer-drag selection move, pan, and
text-edit sessions remain bounded gesture owners, but every reset boundary
cancels them together with the canonical interaction. No component preview,
rail endpoint, clipboard, authored Wire step, routing mode, drawing point, or
snap guide is stored in a parallel React mode flag.
Command arbitration reads the reducer's synchronously advanced state, not the
last rendered React closure, so consecutive native events such as `Escape -> C`
observe the first transition even when React batches the next render.

Wire defaults to orthogonal. While Wire is active, a middle-button click
switches only the unresolved leg between orthogonal, 45-degree octilinear, and
any angle ([Routing rationale](../adr/routing.md));
a middle-button drag pans as usual. F3 opens Wire options including corner
order. Existing authored legs are immutable under mode switches; Backspace
removes the latest authored step rather than an automatically compiled elbow.
A wire is the gesture that drew it: the compiled legs run between the points
the pointer fixed. A pin never pushes the wire out along its own direction —
reaching a downward pin from the side is an ordinary drawing, not a mistake to
correct — and a run that passes over an unrelated symbol stays as drawn. A
visible pin on the path remains an intentional electrical contact.

Where the drawer has not ordered the corner, a fresh orthogonal connection
refuses only the shapes that draw something untrue: a leg lying inside the
conductor the wire just tapped, which hides both, and a leg running over
another pin of a component the wire is attaching to, which the planner never
joins, so the drawing would show a meeting the netlist does not have. The
editor takes the compiled corner when it draws neither, else the opposite
corner — the same two legs in the other order, preferring the one that stays
off the bodies it lands on — and only when both corners would draw an untrue
shape does it turn once between the two ends instead. A wire continued from a
Junction already on the sheet keeps the leg it grew from.

Wire hover and primary clicks on Pins, Routes, and the canvas use one electrical
target resolver. Capture follows the drawing at seven document units, bounded
to a radius of 6–24 screen pixels through the live SVG transform. The smaller
visible endpoint circles are indicators, not a separate electrical hit policy.
Route capture and ranking use the closest point on the actual conductor;
grid/arrival quantization happens only after selecting it. A captured target
has a distinct preview marker and one click completes the connection. A free
canvas click fixes a step; double-click or Enter finishes a free end. Alt
suppresses electrical capture, and ambiguous coincident Nets require a clearer
target instead of an arbitrary connection. A Junction and every Route arm that
meets it, including two collinear arms, are one target, so a wire starts or
ends on an existing Junction dot.

Activating the same tool is idempotent: repeated C, W, or selection of the
same Library item preserves the active session. Activating a different creation
tool replaces the current interaction atomically after drag and snap cleanup.
During component or Copy Placement, `R` turns the transient preview by 90 degrees;
`Shift+R` mirrors it left/right and `Ctrl/Cmd+R` mirrors it top/bottom. Every
subsequent committed copy receives the same transient orientation, while the
source selection remains unchanged. The status bar's grid button, beside the
zoom controls, shows and hides the background grid dots in one click; it reads
**Grid On** / **Grid Off** in wide windows and collapses to its icon at
half-window widths (1100px and below). It is the same editor-local state as
`canvas.showGrid` in Style settings and changes only the canvas paint. Instance reference labels use the first active Document grid line one interval beyond
the drawn symbol ink. The padded interaction envelope never contributes to
that clearance, and placement uses nearest-grid normalization for calibrated
finite-decimal ink edges rather than directional outward snapping. A 45-degree
turn reflows a canonical label from its local side at that fixed spacing; eight
such turns return its position and alignment to the initial values. Opening
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

## Selection alignment

The session-only **Selection Filter** is enforced by one editor-local
`SelectionPolicy`. Every direct acquisition surface asks that policy before an
existing object can be selected, dragged, edited, opened by context menu,
consumed by a verb-first command, or manipulated through a handle. Click,
directional marquee, Select All, Wire/Junction endpoint hits, drafting shapes,
and buried-wire warning spans therefore cannot disagree about selectability.
Changing the filter immediately removes newly disabled classes from the
current formal selection and dismisses their route or drafting handles.

Filtering changes targetability, not the schematic model. Drawing tools,
Simulation probe picking, visibility, connectivity, and creation remain
unchanged. In particular, Wires and Junctions disabled in the filter still
follow a selected device when the movement closure requires them; this is an
electrical consequence of moving the selected device, not a second direct
selection. Project Search and diagnostic navigation remain explicit locator
operations rather than pointer acquisition and may focus their canonical
object without changing the filter.

The six visual alignment commands — left, horizontal center, right, top,
vertical center, and bottom — share one editor command and one alignment
planner. The Edit menu and the shared canvas context menu are presentation
surfaces for that same command; neither owns a separate alignment behavior.

Instances, schematic annotation text, and DraftText use the same click
selection entry point: a plain click replaces the selection, while
`Shift`/`Ctrl`-click toggles that object without discarding other selected
kinds. Right-clicking an already-selected one preserves the complete mixed
selection and opens the shared context menu; right-clicking an unselected one
selects it first. The shared context menu is limited to direct selection
operations: Duplicate, Rotate, horizontal/vertical Mirror, Delete, and Align
when multiple eligible objects are selected. Device replacement, hierarchy
creation/placement, and image export do not appear in the canvas context menu.
Pin-compatible drawing variants remain explicit Properties code;
selected-image clipboard export lives under Edit.

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

[Project-aware copy](#project-aware-copy) owns cloned identity, dependencies
and name semantics, including formal Cell Pins. Movement does not define a
second copy protocol.

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
remain untouched. A dragged 45-degree segment never moves diagonally: it
translates horizontally or vertically, whichever way the pointer mainly
travels. A leg along that axis lengthens or shortens (it may shrink away but
never folds back), and a leg across it travels with the segment. A Junction at
the end of that run travels too; a pin is reached by a jog along the axis.
Slanted segments are never bent by a drag: a slanted neighbor of a dragged
segment, orthogonal or 45-degree, travels with it in the same run. A move that
would double the wire back on itself is refused. A drag that ends with nothing
moved, including a refused one, records no edit and no undo step. A protected
adjacent `locked` or `trunk` segment rejects the gesture rather than being
rerouted. Power rails use their explicit translate
and endpoint-resize intents, never an inferred route search. Endpoint resize is
limited to the rail's current axis. Whole-rail translation includes its tap
Junctions and incident geometry, so a connected rail does not fragment.

Normal canvas hit ranking prefers a symbol, Route, or Junction over an
overlapping label so routine moves do not accidentally drag text. Text remains
individually selectable when it is the only hit, and Alt cycling deliberately
selects an overlapping label. A deliberate double-click is an editing intent,
not a movement intent: it resolves an overlapping editable annotation directly
without requiring an Alt cycle.

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
atomic transaction. Contact acquisition follows the
[connectivity authoring rules](connectivity-and-routing.md#authoring-rules);
hover and preview are not electrical mutations.

## Project-aware copy

Internal `C`, Gallery canvas insertion, and the existing Agent copy command
use the same Project-aware copy planner. C retains its pointer-following ghost,
rotation/reflection shortcuts, repeated click placement, and Escape cancellation.
Gallery selects the source top Cell body; referenced child Cells remain hierarchy
and are imported as dependencies. Inserting a nonempty hierarchical Gallery entry
does not replace the current Project.

A transient copy capsule carries the selected objects, Cell parameter context,
referenced external interfaces, child-Cell closure, symbol-library identity, and
referenced source-file records. It is not persisted or added to the Agent API.
Source-file records are provenance, not bundled PDK model contents. Simulation
folders, simulator configuration, run results and unrelated Cells are not copied.

Every placement allocates new canvas object IDs and collision-free References.
Compatible external definitions are reused by validated interface and presentation,
not by coincident source IDs. Incompatible same-name definitions or Cell parameter
defaults reject before placement. Child imports share one immutable source snapshot;
a changed source receives a new snapshot identity. A previously imported child that
was edited in the destination cannot silently substitute for the captured source.

Internal wires of a selected component group travel with the group. A single
component does not automatically carry its unselected dangling wires. Explicitly
selected wires can travel alone: unselected terminal endpoints become local free
wire ends, without bringing the external devices. Route markers remap both Route
and Leg identity. External visual anchors on copied drafting resolve to free
positions; bound component labels require their component. Bulk connections are
materialized as instance-owned connections rather than adopting target defaults.
Necessary Net names whose original owners were outside the selection receive
copy-owned labels. Name equality in the target Cell retains its ordinary electrical
meaning; copying does not introduce an invisible Net namespace.

Source and target must have compatible grid geometry and matching document style
defaults. The current model cannot represent all symbol-stroke and junction-radius
defaults per object, so incompatible defaults produce an explicit refusal instead
of silently changing the drawing or overwriting target presentation.

Dependency planning and preview do not write to the Project. Preview resolves
symbols using the planned definitions, and placement rechecks the current target.
Dependencies, instances, wires and interface updates commit as one existing Project
transaction and one undo unit. Cancelled or rejected copies leave no definitions
behind. Repeated placements share definitions but own separate canvas objects.

## Text and presentation

Every visible editable label is one persisted RichText annotation. Component
insertion uses one default-display policy: ordinary instances receive an
`instance-reference` label, which projects only `Instance.reference`.
Internal Cells receive only their Cell/master presentation in the normal
Reference slot; external subcircuits additionally receive it below their
visible Reference. The default internal-Cell text follows a Cell rename while
deliberately customized literal content remains custom. A Cell Pin receives only an object-anchored
`cell-terminal-name`; and parameter values use `instance-value` when requested
and displayable.
Properties exposes **Netlist Reference** for explicit electrical renaming:
case-insensitive Document uniqueness and device-prefix validation still apply.
The canvas exposes **Visual annotation**. Instance labels follow
`Instance.reference` by default. Editing an unaliased name changes that
Reference through the same prefix and uniqueness validation as Properties and
the editable netlist; its Annotation ID, anchor and presentation stay intact.

**Use display alias** is an explicit checkbox in the floating label editor.
Checking it keeps literal RichText on the same Annotation, independent of the
netlist name. Existing literal annotations open with it checked. Alias mode
supports bold, italic, scripts, overbar, symbols, alignment, Shift+Enter and
formulas. Plain synchronized names do not accept arbitrary formatted aliases.
Unchecking immediately restores the live Reference binding and default content
styling, retaining position, size, alignment, color and visibility. The toggle
is undoable; Cancel discards subsequent text edits, not a toggle already made.
Typing the Reference into a checked alias does not implicitly disable alias mode.
Copy allocates a unique Reference: following annotations update, aliases copy
exactly. Old additional annotations remain user-authored content; no hidden
second label is created.

For a Cell Pin, a character edit renames the terminal while a formatting-only
edit persists a same-text annotation `formatOverride`. Its name is edited on
the canvas and its interface direction is managed in Cell Manager; Properties
does not repeat either control below the component code. Net naming remains a
Net Label operation.
The renderer never synthesizes text from Instance IDs and no empty suppressor
label exists. Visual annotation display is a Properties toggle for one or many
selected components: hiding sets the annotation's optional `visible: false`
flag, which renderers and hit/marquee surfaces skip while the annotation stays
in the Project, so hiding is recoverable and a missing label can be re-created
from the same toggle. Component value display is the paired `Value` toggle on
the same control row: MOS devices project `W/L` as a stacked fraction with a
fraction bar, passives and independent sources project their scalar parameter,
and every projected value is upright bold text preserving authored spelling
(`150n` stays `150n`, `EV` stays `EV`; `150nm` stays `150nm` when explicitly
entered). No unit suffix is invented. The toggle's availability
follows the live property draft — typing a value enables it without
reopening the panel — and checking it commits the typed parameters and shows
the projected value in one transaction. Showing a value re-projects its text
without touching electrical parameters or a user-dragged anchor; the Edit
Engine refreshes a non-hand-edited value after parameter edits. Value labels
can be grabbed anywhere in their visible text, including a fraction's
numerator, and dragged without a host-distance limit. The annotation grid
still rounds their position; their object anchor retains the authored offset
when the component moves or rotates and through Project file save/load. Net/power
labels carry Net identity separately from their
visual anchor. A resolved anchor drives both the glyph and every text
hit/marquee surface; its fallback is only for an orphaned target, never an
editor-local alternate position. Dragging a route-anchored Net label re-anchors
it along its own Route (segment, t, and a generous normal-offset band) instead
of moving a fallback position. Selecting a `power-rail` together with its power
label is one visual deletion: the label removal is planned once, so the atomic
transaction cannot reject a duplicated annotation removal. Drafting text has
no electrical meaning.

The standalone `+` and `−` entries in **Annotations** are fixed polarity
marks, not editable text. Their vector-stroke center is the placement anchor,
so the preview, snapped click point, persisted mark, hit target, and selection
frame all share one center. Their empty compatibility content contributes no
text bounds and double-click does not open the RichText editor. The combined
`+ / text / −` polarity annotation remains editable in its center as before.

Selecting an Annotation exposes its own Text color control. Auto removes only
that Annotation's `textColor`; instance reference/value text then inherits the
owning Instance's effective foreground, while other annotations use the
Document profile foreground. Selecting drafting text exposes its independent
drafting color override, whose Auto state uses the Document profile foreground.
Both controls transact through their owning object and preserve unrelated
style fields, selection, and electrical content.

The floating RichText editor also inserts canonical `fraction` runs at the
caret in notes and literal visual annotations. Numerator and denominator are
editable in place; Tab advances through the two parts and back to surrounding
text, while Shift+Tab reverses that navigation. A selection with one unambiguous
slash is converted without losing its character styles; other selections become
the numerator. Editing and reopening preserve fraction nodes. Fractions can be
mixed with styled companion text and additional fractions on the same line.
Their bars are formal SVG line elements, so canvas and exported artwork agree.
The existing W/L projection retains its established geometry. Source-only fields
and bound electrical names do not gain arbitrary fraction formatting, and an
atomic Formula continues to use its existing editor.

The floating RichText editor has one formula action for editable text content.
It opens a MathLive math field plus the exact LaTeX source, lets the author
choose inline or display intent, validates against the bounded Analog Canvas
math profile, and replaces the current RichText document with one atomic
formula only after validation succeeds. Ordinary bold, italic, script,
overbar, alignment, multiline, and symbol controls remain the same RichText
system; formulas do not create an Additional Text or Annotation side channel.
For a Net or Cell terminal name binding, Formula Insert checks the proposed formula before
it changes the editing session. A bounded formula made only from groups,
scripts, overbar, bold/italic wrappers, and supported Greek symbols is compiled
to the same canonical RichText presentation when its flattened characters
still equal the bound name. Device visual annotations accept any formula allowed
by the math profile, without name-equivalence checks or conversion prompts.
Net and Cell terminal names refuse a non-equivalent formula in
the Formula panel. Ordinary character edits and formatting commands do not use
this formula-only decision path.

## Project sessions

New, Open, SPICE import, Gallery/built-in example open, and recovery restore are
Project-session transitions rather than Document edits. A dirty current Project
always requires an explicit discard or cancel decision before one of these
transitions commits; a successful browser-recovery write is safety evidence,
not authorization to replace the foreground Project. Candidate files and
gallery/recovery payloads are parsed and validated before that decision.

The editor has no Previous Project stack: replacing a live session does not
retain the outgoing Project in memory for a later swap, and the File menu
offers no **Previous Project** command.

Project dirty detection covers `structureRevision` and every Document revision,
not only the active Cell, and compares the content with the last acknowledged
Cloud baseline so Undo can return to clean. **New Project** creates a new canonical Project with
one empty Main Cell, no SPICE source manifest entries, and no external
subcircuit definitions; it does not mutate the previous Project into an empty
shell. Opening a Cloud Project binds its stable id and revision to the runtime
session; importing a file does not. After a Cloud Save, **Revert to Last Saved**
restores that acknowledged content through the same guard. Export and backup
never establish or advance this baseline.

## Cell reset lifecycle

Cell reset commands live in the selected definition's **Cell Manager → Reset
Cell** section. The Manager submits the existing Document edit through the
Project `transact_document` boundary so an inactive Cell can be reset without
opening it first; one Undo restores the atomic Project transaction. Each command
previews an exact affected-object count before commit:

- **Clear Drawing** removes authored Route geometry and drafting objects while
  retaining Instances, Nets, Junction topology, ports, and semantic
  annotations.
- **Reset Cell Placement** (Agent authoring only) returns every placed Instance
  to the Placement Tray, removes Route geometry and placement
  constraints/groups, and retains the devices, Nets, Junction topology, and
  formal interface. The next open of that Project draws the returned Instances
  again, so the reset is a redraw step, not a lasting off-sheet state.
- **Reset Cell Body** removes non-interface electrical and drawing content but
  retains formal terminals, their interface Port markers, their Nets, and
  terminal annotations. Existing parent callers therefore keep the same pin
  contract.

**Delete Cell** remains a Project-structure transaction and is legal only for
a non-top Cell with no callers. That precondition is checked by the hierarchy
planner before the transaction is submitted.

## Files, recovery, and replacement

Open, example load, restore, and human-approved staged import replace the entire
Project through one replacement boundary; they are not Edit Engine
transactions. Replacement cancels pending recovery for the outgoing Project
and terminates its Agent session. A complete Project covered by the schema
24→57 upgrade chain may be upgraded at the read boundary and then enters the
editor only as schema-58; migrated files are marked as needing save.

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
Cloud Save (private Cloud Projects, up to a per-account limit) from local
Project-file export without exposing browser-recovery internals. The limit it
shows is the editor's shared Cloud Project limit, the same value the File menu
counts against, not a figure written into the dialog text. A startup recovery
offer is a non-modal overlay and never silently
replaces the active Project.

Same-site destinations owned by the product, including Gallery and Analytics,
enter through this application replacement guard. Their anchors retain normal
link behavior for modified clicks, but an ordinary primary click must not fall
through to a second native `beforeunload` prompt.

## Agent semantic control

API 3.0 may advertise optional `semanticControl` for transient review focus:
select a canonical locator, highlight a Net, activate/fit an existing Cell, or
clear focus. It cannot send pointer events, keystrokes, CSS, selectors, DOM
queries, or arbitrary zoom matrices. Semantic control never changes revision,
topology hash, history, recovery, or formal export.

## Deterministic validation

- state-transition, shortcut focus-guard, and command-by-interaction matrix
  tests, including repeated C/W, unbound A and K, I/Escape/re-entry, and
  render-free `Escape -> C` bursts after NMOS, PMOS, and passive placement;
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
