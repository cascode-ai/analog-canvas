# Editor Interaction

Status: `accepted`

Primary owner: `apps/editor`

The editor is a direct-manipulation client over one current `SchematicDocument`.
Human and Agent mutations share the Edit Engine, revision, validation, undo,
rendering and recovery.

## Components and interface markers

- Library, `I` and **Place Cell** are views over one editor-local insert
  controller (`all` picker, `cells` picker, or a chosen Symbol) delegating to the
  component, Cell, Cell-Pin, external-master or VDD-rail planner. It adds no
  Project type, Edit Engine operation or Agent endpoint.
- A Cell placement shares cursor preview, snap, rotation, mirror and cancel with
  Symbols and creates one typed subcircuit Instance through a Project structural
  transaction. `Xn` is its sole Netlist Reference; an internal Cell shows its
  Cell/master name in the Reference slot (text without identity authority).
- Hollow `port` (**Cell Pin**) and filled `port-filled` (**Bias Voltage Port**)
  are formal terminals sharing storage and planner; pin `P` is an ordinary
  terminal. Placement atomically creates the Instance, membership and one
  ordered Cell terminal, so callers see it without an expose step.
- New Pins allocate `Vinp`, `Vinn`, `Voutp`, `Voutn`, then `Vin2p` … `Vout2n`;
  Bias Ports `VB1`, `VB2`, …; a named contact or explicit text wins; direction
  starts `passive`. Duplicate names are valid; placement and rename change only
  the selected Pin (never attach, merge or sync).
- **Enter Cell** opens only a hierarchical Instance. A Pin shows only its
  terminal-name annotation; direction lives in Cell Manager. Caller
  reconciliation compares the name projection before/after, does nothing while
  the old-name group survives, and never merges caller Nets.
- Delete reuses the instance/route deletion proposal. A run that only tapped the
  deleted part (through bends joining nothing) goes when it ends at other wires,
  another deleted pin or the open; one reaching another part's pin stays open
  there; labelled runs and Power Rails stay. Retained geometry gets Junctions;
  memberships, NoConnects, owned labels, layout references and the Instance go
  in one transaction.

## Component property code

**Properties** shows a component as strict JSON: `placement` (`coordinate`
`[x, y]`, `rotation` in 45° steps, `mirror` `none|horizontal|vertical|both`),
`appearance.color`, `display`, `displayName`, `parameters`, `netlistName`,
`netlistTarget`, optional `symbol` and `signalFlow`.

- `displayName` is visual and may differ from `netlistName`. Valid code plans the
  existing typed edits as one transaction (a target switch composes the
  structural planner); unknown keys or invalid values reject without change.
  `parameters` are raw strings; empty or removed keys unset.
- Initial values: R/C/L `1k`, `1p`, `1n`; T-coil `L1=1n L2=1n K=1 CB=1p`; XFMR
  `Lp=1n Ls=1n K=1`. Their `display.parameters` switches each control one live
  label; clearing a value hides it.
- Colors show as `[R, G, B]` but persist as hex; `"auto"` inherits foreground.
  Components have no background/fill (historical overrides stay readable and
  retire on the next Appearance edit); shapes use `appearance.fillColor`.
- `symbol` offers only pin-compatible variants; `signalFlow` owns formula
  overrides. `placement: null` is refused for drawn devices.
- Units, selectors and switch/rotate/mirror/color buttons are decorations, never
  document text; they edit the same draft and are disabled while it is invalid.
  Mirror buttons never rewrite `rotation`. Enter applies; Shift+Enter breaks.
- A MOS `display.parameters.m` switch notes "in W/L" or "hidden by W/L" while the
  W/L shows; an unset m has neither.
- Invalid drafts keep the last accepted canvas (**Discard draft** restores it);
  external undo syncs without replay; **Defaults** reloads parameter,
  orientation, color and formula defaults, keeping coordinates, names, target,
  display flags and unknown overrides. Selection changes never carry a draft.
- Rectangle/circle **Border** and **Fill** are independent; **Bring to front**
  keeps the interior selectable, **Send to back** leaves only the border as hit
  target. Both are undoable.

### Drawn and unplaced Instances

- A schematic is what it shows: import lays devices on a deterministic shelf and
  opening a Project draws hidden legacy Instances with default projections.
- The **Placement Tray** lists Instances still without placement (older
  sessions, Agent `unplace`/`reset-placement`), counted by
  `ERC_INSTANCE_NOT_DRAWN`; items can be dragged, cursor-placed or **Place
  all**ed into a starter grid. Unplaced labels are kept but not drawn or hit.

### MOS bulk

- `nmos`/`pmos` default to `textbook-3terminal` artwork but keep D/G/S/B; body
  resolution follows [connectivity](connectivity-and-routing.md#mos-bulk).
- Properties shows Bulk as one row (Net, Unconnected or No Connect) with a draw
  action, disabled while unplaced. A bulk route inherits its MOS color and
  offers only a bulk delete.

## Formula-capable behavioral blocks

- Integrator (`1/s`), Unit Delay (`z^-1`) and Discrete-Time Integrator
  (`z^-1/(1-z^-1)`) are presets of one Transfer Function presentation;
  Transconductance (`g_m`) has adaptive single-input and fixed differential forms.
- `_` and Unicode subscripts render as SVG subscripts at one 12-unit size;
  fractions do not shrink. Adaptive frames grow on the 10-unit grid (authored
  sizes are minimums) and drive endpoints, hit bounds and default labels.
- Formula, coefficient and size are schematic-only; behavioral blocks need an
  explicit implementation mapping to netlist.

## Supplies

- Ground is `ground` on pin `0`, reusing the global ground Net. VDD Power places
  a local formal Cell Pin; Properties can make it Global.
- Power Rail: preview follows the pointer, the first click fixes an end, the
  dominant axis picks direction, the second click creates the rail per
  [connectivity](connectivity-and-routing.md#rails-and-supplies) with its label
  as formal terminal owner (or keeping an existing Global supply). Its artwork
  is preview-only; it creates no VDD Instance and exits placement.
- VDD Power and Power Rail labels store the V_DD look as their own
  `formatOverride`; the name keeps its spelling (`VDD`). Typing renames exactly,
  keeping the look for `V`-led names; restyling never renames.

## Interaction states

One canonical reducer owns the canvas: `Idle`, `SymbolPlacement`,
`VddRailPlacement`, `CopyPlacement`, `SelectionMove` (`M`/`Shift+M`), `Wire`,
`Drawing`.

- Box selection, drag-move, pan and text editing are bounded gesture owners
  cancelled at every reset boundary; no transient state lives in parallel React
  flags. Arbitration reads the reducer's synchronously advanced state, so
  `Escape -> C` works within one render batch.
- Escape, Document switch, Project replacement, Clear Canvas, restore, Agent
  focus reset and opening `I` share one cancellation boundary.
- Same-tool activation is idempotent; another creation tool replaces the
  interaction atomically. Selection commands never act on a stale selection
  beneath an interaction; Undo/Redo may cancel a snapshot-dependent one.
- During placement `R` turns 90°, `Shift+R` mirrors left/right, `Ctrl/Cmd+R`
  top/bottom; later copies inherit it.
- `T` places text through the placement state; nothing changes before the click.
- Polyline: click vertices; double-click/Enter finishes; clicking the first of
  ≥3 vertices closes it; files keep the free-arrow path representation.
- Drawn objects use the annotation pitch (1, 5 or 10; default 5), except
  rectangles, which round to the electrical grid so wires can meet their edges.
  Rectangle side handles move one side (dragging past flips); corners draw on
  top.
- Reference labels keep four units between their ink and the symbol ink, at
  whole-unit coordinates; eight 45° turns restore them.

### Wire

- Wire defaults to orthogonal; middle-click or `/` cycles the unresolved leg
  through orthogonal, octilinear and free ([routing rationale](../adr/routing.md));
  F3 sets corner order; choices persist. Backspace removes the last authored step.
- A wire is the gesture that drew it: pins never push it outward; runs over
  unrelated symbols stay; a visible pin on the path is an intentional contact.
- Without an ordered corner, a fresh orthogonal connection avoids a leg inside
  the tapped conductor or over another pin of its part: compiled corner, else
  the opposite, else one extra turn. A wire from a Junction keeps its leg.
- One target resolver serves hover and clicks: 7 document units clamped to 6–24
  screen pixels, ranked by closest conductor point before quantization. A
  captured target completes in one click; Alt suppresses capture; ambiguous
  coincident Nets need a clearer target; a Junction and its arms are one target.

## Selection alignment

- The session-only **Selection Filter** is one `SelectionPolicy` consulted by
  every acquisition surface; changing it drops disabled classes from the
  selection. It never affects drawing, probing, visibility, connectivity,
  movement closure, Search or diagnostic navigation.
- Click replaces; `Shift`/`Ctrl`-click toggles; right-clicking a selected object
  keeps the mixed selection. The canvas menu holds only Duplicate, Rotate,
  Mirror, Delete and Align.
- The six align commands share one planner. Participants: placed Instances,
  selected annotations and DraftText (an anchored label with its host follows
  once); not Routes or Junctions. One undo. The GUI never calls `align_instances`.

## Movement closure

- Each move derives one transient stable-ID closure; the Edit Engine's
  `planRoutingTransform()` owns preview and commit. Handlers never invent a
  follow set.
- Snap targets exclude the moving closure; capture is bounded by half a grid
  step; exact contact may add connections at a retained landing but never move it.
- `M` translates with internal conductors and stretches boundary Routes.
  `Shift+M` (and Ctrl/Cmd-drag) leaves wires: each routed terminal becomes an
  open Junction stub, then `disconnect_endpoint`, and a pin set directly on
  something staying (a ground marker on a source) lets go of it; geometry stays
  byte-identical.
- Classification: selected Instances translate; a Route/Junction component with
  all terminal ends selected translates; a Route with one selected end stretches;
  a selected loose Route moves only with both loose Junctions; other connected
  Routes stay; anchored annotations follow; free ones move only when selected.
  Followers move once with their owner; locked text stays; route-anchored
  DraftText cannot leave a stationary Route.
- One gesture session freezes source, closure, route facts and snap targets;
  members share one grid-disciplined displacement keeping fine offsets. Preview
  frames project geometry without revisions; release runs the strict
  transaction once. Frame caches key on exact sub-pixel input and the canvas
  mapping; Alt at click is carried into planning.
- Engine instance-follow is the single-instance fallback and agrees on internal
  wiring (a component whose pins slide together travels whole).
- `C` is modal copy placement with one preallocated clone mapping; Delete turns
  the visual selection into one graph deletion plan.
  [Project-aware copy](#project-aware-copy) owns copy identity.
- Marquee: left-to-right is window (fully contained; Routes need their whole
  centerline), right-to-left crossing; a Junction is its point; Route tests use
  actual segments; native text selection is suppressed.

## Selection mirror

- `Shift+R`, `Ctrl/Cmd+R` and the menu mirror the selection as one drawing about
  one axis without changing connectivity; the movement closure decides what
  travels. If nothing can move, the status says why.
- The axis passes through selected Instance positions, else carried Junctions,
  else selected boxes, on a half-grid line so mirroring twice restores.
- Glyphs never mirror: text boxes reflect and `start`/`end` swap along the
  reading axis; Route labels keep `t` and take the mirrored side; a part's
  grouped name/value stay a group (name first); arrows keep their head end;
  attached ends mirror their offset. One undo; Agent `transform` mirror without
  a centre takes the same path.

## No-reroute movement boundary

- Transient intents (`move-selection`, `stretch-segment`, `move-loose-route`,
  `move-power-rail`, Route and rail endpoint resizes) compile to existing typed
  edits; none is Project data, Engine command or Agent API.
- No movement searches for a path: internal Routes translate by one delta; a
  boundary stretch changes only geometry next to the moved end (or adds one
  elbow).
- A dragged 45° segment moves along the pointer's main axis (switching axis
  rather than folding back); legs along it lengthen without folding, legs across
  it travel; pins are reached by a jog on the pin's perpendicular; slanted
  neighbours travel, never bend.
- Folding a wire back on itself or touching an adjacent `locked`/`trunk` segment
  refuses; a drag moving nothing records no edit. Rails translate whole and
  resize along their axis.
- Hit ranking prefers symbols, Routes and Junctions over labels; sole hits, Alt
  cycling and double-click reach labels.

## Coordinate normalization

- Previews may hold floats; every committed point snaps to the Document grid; one
  grid-aligned camera normalizer serves fit, zoom, pan, focus and Agent focus.
- Frame-zoom: right-drag on empty canvas or Alt+left-drag; it never touches the
  revision; a press within one grid cell stays a click.
- Escape cancels without mutation; a committed gesture is one transaction;
  contacts follow the [connectivity authoring rules](connectivity-and-routing.md#authoring-rules).

## Project-aware copy

- `C`, copy/paste, Gallery insertion and Agent copy share one Project-aware
  planner with the same contact and Reference rules. A copy in hand survives tab
  switches and is re-prepared for the target. Gallery inserts the top Cell body
  with child Cells as dependencies without replacing the Project.
- The transient capsule carries the selection, Cell parameter context, external
  interfaces, child-Cell closure, symbol-library identity and source-file
  records (provenance only); a complete Cell also carries its bound source
  folders. Results, model bytes and unrelated Cells never travel.
- New IDs always; a Reference is kept when free, else the next free one. Net and
  Pin names stay exactly as authored, even on collision; no `_copy` suffix.
  Labels keep RichText, typography, color and offsets.
- A lone Net Label dropped within the Net Label tool's capture radius of a wire
  attaches to it (one undo); elsewhere it stays free.
- Text spelling the Reference follows the new Reference; other text stays; a
  hidden Reference stays hidden; a VDD marker carries a label only if its source
  showed one.
- Equal names resolve to one Logical Net; behavioral references to renamed
  instances reject. External definitions are reused by validated interface and
  presentation; incompatible same-name definitions or defaults reject before
  placement. Child imports share one immutable source snapshot.
- A group's internal wires travel; a single part leaves its dangling wires;
  selected wires travel alone with free ends.
- A copied MOS body stays on its source Net when that Net travels, else takes the
  target default; undrawn pins travel with their Net; whole-Cell composition
  keeps bodies as instance-owned connections. Necessary names owned outside the
  selection get copy-owned labels.
- Grids must match. Differing style defaults make each copied object keep the
  source factors as `documentStyle` ([file format](project-file-format.md));
  a different style profile refuses.
- Planning never writes the Project; placement rechecks and commits
  dependencies, instances, wires and interface updates as one undo; rejected
  copies leave nothing.

## Text and presentation

- Every visible editable label is one persisted RichText annotation; nothing is
  synthesized from IDs.
- Defaults: instances get `instance-reference`; internal Cells their Cell/master
  name in the Reference slot (following renames unless customized); external
  subcircuits also below the Reference; Cell Pins `cell-terminal-name`; values
  `instance-value` when requested.
- Editing an unaliased name renames `Instance.reference` with the same prefix and
  case-insensitive uniqueness validation as **Netlist Reference**.
- **Use display alias** keeps literal RichText on the same Annotation. Text that
  cannot be the netlist name (not portable, wrong device letter, another part's
  Reference) checks it automatically and keeps the Reference; unstyled aliases
  draw in Reference style. Unchecking restores the binding keeping position and
  style; the toggle is undoable. Copies: following labels update, aliases copy
  exactly.
- Batch `name` on several parts: the part already named keeps it, else the first
  that can take it is renamed; others show it as an alias. A Pin never takes
  another Pin's name. One transaction.
- Cell Pin character edits rename the terminal; formatting-only edits store a
  same-text `formatOverride`; Pin aliases are drawn by the parent pin; a Pin
  label still showing its name rebinds on rename.
- Hiding sets `visible: false` (skipped by render and hit tests, recoverable). A
  part's name and value are one group on their side: hiding one moves the other
  into its row; hand-moved labels stay.
- `Value` projects MOS `W/L` as a stacked fraction and passives/sources their
  scalar, upright bold in authored spelling, no invented units; checking it
  commits typed parameters in one transaction. The Edit Engine refreshes
  non-hand-edited values; value anchors keep offsets through moves and files.
- A route-anchored Net label dropped within 20 units along its Route re-anchors
  there; farther it becomes free but still names its Net.
- A new Net Label (`L` or naming a Wire) sits above a horizontal segment with its
  lowest ink 4 units clear (up to a grid step) or right of a vertical one;
  preview equals commit. An Agent label at an unclear spot on an open-ended
  segment moves to the clear open end, else slides a grid step at a time to the
  nearest clear spot, else stays.
- Selected labels (and a lone selected part's) draw a tether to their owner.

### Text authority and formatting rules

| Text on canvas           | Authority                         | Text edit                                   | Formatting-only edit                                 |
| ------------------------ | --------------------------------- | ------------------------------------------- | ---------------------------------------------------- |
| Following instance label | `Instance.reference`              | Renames the Reference (validated)           | Same-name `formatOverride`; binding stays live       |
| Instance display alias   | Annotation `content`              | Alias only                                  | Alias only                                           |
| Cell Pin label           | Formal terminal name              | Renames the declaration, reconciles callers | Same-name `formatOverride`, projected to parent pin  |
| Cell Pin display alias   | Annotation `content`              | Alias only; Pin keeps its name              | Alias only, drawn by the parent pin                  |
| Net or power label       | Its name claim or formal terminal | Owning Net/terminal rename path             | Keeps the name, stores presentation                  |
| Free drafting text       | Drafting `content`                | Drawing only                                | Drawing only                                         |

- [Names and labels](names-and-labels.md) owns typography and drawing-wide
  formatting. Text edits rename exactly as typed; style never renames.
- Standalone `+`/`−` marks are fixed strokes centred on their anchor, with no
  text bounds or editor.
- Text color Auto removes the annotation's `textColor` (instance text inherits
  the Instance foreground, others the Document profile).
- The RichText editor inserts `fraction` runs (SVG bars); bound names take none.
- Symbol body text is an editable label: body words (ADC) default upright,
  single-letter quantities (A, A_v) italic; a differing look is stored beside
  the text and removed when restored; compact syntax (`z^-1`, `g_m`) still draws.
- Formulas (MathLive plus LaTeX) validate against the Analog Canvas math profile
  and replace the document with one atomic formula. For bound Net/Pin names a
  formula compiles to RichText only when its flattened characters equal the name;
  otherwise it is refused. Device annotations accept any profile formula.
- `\phi`/`\Omega` + Space becomes the Greek letter.

## Project sessions

- Project renames (tab double-click, or Project Info which also renames the
  on-screen Cell via `rename_project` + `rename_document` in one undo) commit only
  a changed nonempty name, ≤120 characters (longer old names are never
  truncated). Renames mark dirty but never save, rebind or republish.
- Tab menu: Close, Close Others, Close All; dirty tabs need one decision; Close
  All leaves one blank tab.
- Opening, activating and replacing are distinct session operations, not
  Document edits. Activation keeps every tab's controller and undo; discarding
  dirty work needs a decision; a recovery write is not permission. Candidates
  are validated before installation.
  [Persistence](persistence-and-recovery.md#browser-window-workspace) owns
  refresh restoration.
- Dirty detection covers `structureRevision` and every Document revision against
  the last acknowledged Cloud baseline. **New Project** creates one empty Main
  Cell. Opening a Cloud Project binds id and revision; importing does not.
  Export and backup never move the baseline.

## Cell reset lifecycle

Resets are Agent commands through `transact_document` (inactive Cells allowed),
one undo, reporting the exact affected count (also in dry run).

- **Clear Drawing** removes Route geometry and drafting objects, keeping
  Instances, Nets, Junction topology, ports and semantic annotations.
- **Reset Cell Placement** returns Instances to the tray and removes Route
  geometry and placement constraints; the next open redraws them.
- **Reset Cell Body** keeps only formal terminals, their markers, Nets and
  annotations, so callers keep the pin contract.
- **Delete Cell** applies only to a non-top Cell with no callers.

## Files, recovery, and replacement

- Open, example load, restore and approved staged import replace the tab through
  one replacement boundary (not an Edit Engine transaction) that cancels pending
  recovery and ends the Agent session; files are upgraded
  ([file format](project-file-format.md)) and marked as needing save.
- Selection, viewport, tool, previews, Agent tokens and approval UI never enter
  Project JSON; recovery runs only after a transaction or replacement and stores
  no bearer token.
- With unsaved work, Back, Refresh and close use the browser leave prompt; New,
  Open, Revert, restore and staged replacement use one in-app dialog whose Cloud
  limit is the shared limit the Shelf counts. Startup recovery never silently
  replaces the Project. Same-site product links go through this guard without a
  second native prompt.

## Agent semantic control

API 3.0 may advertise `semanticControl`: select a locator, highlight a Net,
activate/fit a Cell, clear focus. No pointer events, keys, CSS, selectors, DOM
queries or zoom matrices; it never changes revision, topology hash, history,
recovery or export.
