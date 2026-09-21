# Getting Started

## Run from source

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm dev
```

Run `pnpm build` once after installing, and again after pulling package
changes: the development server's Vite configuration loads some workspace
packages from their built `dist/` output.

Open the displayed loopback URL. Open **File** and use **Import SPICE / SCS…**
to select one `.cir`, `.sp`, `.spi`, or `.scs` entry plus its local include
files. **Import Cadence SPICE (`!` globals)…** also treats net names ending in
`!` as global Nets. Imported instances begin unplaced so that the user can
decide the presentation. A normal launch starts with a genuinely empty
`New Circuit` Project whose one Cell is `dut`, for palette-first manual
authoring; no Project file needs to be opened first.

New Resistor, Capacitor, and Inductor instances—including their adjustable
variants—start with `1k`, `1p`, and `1n` respectively. T-coil starts with
`L1=1n`, `L2=1n`, `K=1`, and `CB=1p`; XFMR starts with `Lp=1n`, `Ls=1n`, and
`K=1`. These are authored parameter values rather than placeholders. T-coil
and XFMR remain manual-only compound devices until structural netlist lowering
is defined.

## Edit and connect

- Open **Library** to choose a categorized built-in symbol by its inline
  preview, or press `I` (**Edit / Insert component…**) to search the full
  library, then click the canvas to place it. The
  **Placement Tray** keeps imported or returned Instances without deleting
  their netlist facts: drag one to the canvas, select **Place…** for a cursor
  placement, or use **Place all** for a deterministic starter grid. **Return
  to tray** is reversible through Undo and is distinct from permanent Delete.
- Click to select, `Shift`/`Ctrl`-click to extend the selection, or drag blank
  canvas to box-select. Dragging one selected instance moves the whole
  selection atomically.
- Internal wires and Junctions move with a selected component group; only
  wires leaving the group stretch. Select the components and wires to reuse,
  press `C` to immediately attach a copy to the cursor, then click to place it.
  `Esc` cancels; no `V` is needed.
  With nothing selected, press `C` first and click a component to pick up its
  copy; the following click places it. Further clicks place more copies until
  `Esc` exits, just like copying an already selected component.
- To reuse an editable circuit in another tab or window, select it (or use
  `Ctrl/Cmd+A`), press `Ctrl/Cmd+C`, then switch to the destination canvas and
  press `Ctrl/Cmd+V`. Plain `C` also keeps the selection in the clipboard while
  starting its cursor preview; cancel or switch projects, then `V` starts a new
  placement. Both Ctrl and Cmd are supported on the canvas. Move the preview
  and click to place; `Esc` cancels. Devices, parameters, selected wires, node labels,
  custom definitions and referenced
  child Cells travel together. Name conflicts receive fresh names; explicit
  global supplies retain their normal shared meaning. Each placement is one
  undoable operation. In text/code fields, these shortcuts still copy and paste
  text. Pasting appends to the destination, including when it already contains
  a circuit.
- Open **Project** beside the site logo to edit the full circuit name, inspect
  the current Cell and Gallery contributor/notes, or choose an open project.
  The current project is checked. Enter commits a name; Escape cancels it.
  Long names stay inside the dropdown instead of widening the menubar.
- The compact project tab bar opens several independent circuits in one editor.
  Use **+** for a new project, **Open file in new tab** for a local file, or
  **Open Shelf project in tab** for a saved draft. Tabs keep separate cameras,
  selections, undo histories, Cloud Save bindings and browser recovery copies.
  Copy selected objects, switch tabs, and paste to merge them into that circuit.
  Apply or discard pending code edits before switching. Closing an unsaved tab
  asks first. Open tabs are an in-memory workspace, not a saved tab collection;
  save your projects before leaving. Switching projects ends the previous
  Agent connection and closes its simulation panel.
- Use **Wire** or press `W`, then choose two pins, Junctions, or route segments.
  Passing across a conductor remains a Crossing; ending on one creates a
  Junction automatically. An exact multi-route intersection is rejected as
  ambiguous instead of silently merging Nets.
- While wiring, click blank canvas to fix bends; double-click blank canvas or
  press `Enter` to finish at any grid point. `Backspace` removes the latest
  uncommitted bend and `Escape` cancels the session.
- Select any route segment to expose its movement handle. Drag the handle
  perpendicular to that segment to stretch adjacent geometry without rerouting
  the rest of the wire. If the moved segment lands exactly on a component pin,
  the pin connects and a junction dot appears; crossing another wire's
  interior remains unconnected. The contextual **Delete wire** action removes
  that electrical branch, not only its drawing, and can split its Net.
- Select a component and press `Q` to open **Properties**. Its editable
  JSON keeps raw parameters (W/L/NF/M and additional
  netlist overrides), the independent visual `displayName`, `netlistName`, and
  target netlist together with position as `"coordinate": [x, y]`, plus 45-degree-step
  rotation, mirror, supported Visual annotation/Value visibility, and line color.
  Placement, appearance, and display stay at the top. The code area is ordinary
  selectable raw JSON. Press Enter to confirm without inserting a line break;
  use Shift+Enter when you want a new JSON line. `displayName` changes only the
  drawing label, while `netlistName` is the exported electrical instance name;
  `display.visualAnnotation` only controls the drawing label. Declared parameter
  units appear beside their JSON values without becoming data, and
  `netlistTarget` has a compact inline selector. Type values directly, use the
  small switches after `display.visualAnnotation` and
  `display.value` to toggle label visibility, click the buttons after
  `placement.rotation` and `placement.mirror` to rotate clockwise, mirror
  left/right, or mirror top/bottom. Mirror is written as `"horizontal"`,
  `"vertical"`, or `"both"` and never changes the rotation value. Use the color button after
  `appearance.color` for light gray, red, green, blue, black, and one RGB
  tuple input such as `[220,38,38]`.
  Differential-input blocks expose `appearance.inputsSwapped`; fully
  differential amplifiers also expose `appearance.outputsSwapped`. Edit these
  booleans or use their inline switches to exchange the +/− positions
  independently. Connections follow their named pins, and internal marks stay
  intact. **Defaults** resets both swaps to `false`.
  These controls are visual only and are absent from selected, copied, and
  saved JSON. Fixed colors display as
  `[R, G, B]` (0–255); hex input also works. Type `"auto"` directly to inherit
  document ink. Components expose no `background` or `fillColor`; those belong
  only to drawable shapes that can contain paint.
  Valid edits update the drawing immediately; invalid or rejected edits keep
  the last accepted drawing. Undo restores prior edits. Parameter values are strings: type unit suffixes
  yourself; `EV` remains `EV`, and `2u` is not changed to `2um`.
  The Properties header contains **Defaults**, **Copy JSON**, and **Discard draft**
  when text is invalid or rejected. Defaults restores known defaults immediately
  without moving, renaming or rebinding the component. Copy JSON copies
  the whole draft. Compatible drawing
  variants and formula overrides are in the same editor, with no duplicate
  Parameters/Actions/Netlist Target forms. Drag the panel's left edge to set a
  comfortable width. JSON expands completely; scroll the panel rather than a
  nested text area. Escape leaves the editor without discarding incomplete text.
- For a MOS device, the compact **Bulk** row shows its current Net or
  **Unconnected** beside **Connect**. Click the button to draw from the bulk
  terminal on the canvas. Hover the status for the terminal name and connection
  source. A configured default connection shows its Net rather than a warning;
  **Draw** lets you make an explicit route. The dashed route follows the MOS
  line color; selecting it shows a Bulk-specific action instead of ordinary
  wire styling controls. Place an unplaced device first.
- Netlist export and simulation use actual Bulk connections, including those
  established by placement defaults. Connect a missing Bulk or mark it NoConnect;
  no output path repairs it. Module interfaces and hierarchy calls retain
  their authored Pins and order: no VDD/VSS interface is added automatically.
  Explicitly Global supplies stay global, and separate supplies such as `AVDD`
  and `DVDD` retain their connections. Ground remains node `0`, not a VSS Pin.
- Right-click an endpoint for the distinct **Disconnect endpoint** and
  **Delete connection** actions.
- `Delete` on a connected component now removes the component while preserving
  its wires as dangling Junction endpoints at the former pin positions.
- Select an instance to edit its displayed name. Select a wire Route to add an
  electrical Net label; assigning the same name to another Net explicitly
  connects those Nets. Press `T` or choose **Text** for a non-electrical note: move its translucent
  preview with the pointer, click to place it, then edit the text. `Esc` cancels
  placement. Label handles may be dragged near their owner, while plain text moves freely.
  Text notes and text inside drawn boxes default to **bold**. Use **B** to
  switch selected text to normal weight; that choice survives saving and reopening.
- To mix a stacked fraction with other text, use **Insert fraction** (the
  a-over-b button) in the text toolbar. Type the numerator, press `Tab` for the
  denominator, then `Tab` again to continue the line, for example `+ R₁`.
  Subscript and superscript work inside either part. Selecting `1u/150n` before
  clicking the button converts it while preserving character formatting.
  Double-click a note or visual annotation to edit its fractions again.
  Both parts stay centered under the same axis, and the bar follows the wider part.
  Use **ƒx** for a complete mathematical formula such as `\frac{1}{g_{mN}} + R_1`.
- Press `R` to rotate, `F` to fit,
  `Ctrl+Z` to undo, and `Ctrl+Y` or `Ctrl+Shift+Z` to redo. Shortcuts do not
  fire while typing in a field.
- Use `Ctrl`+mouse wheel to zoom around the cursor and middle-button drag to
  pan. While wiring, a middle click cycles **opposite right-angle corner →
  45° → any angle → automatic right-angle corner**. Auto follows the incoming
  leg; it is one of the two right-angle shapes, not a third extra stop.
  View changes do not increment the Document revision.

## Editing multiple components

Select components together with Shift-click or a selection rectangle, then
press `Q`. Properties shows one editable JSON block. Shared colors and values
are displayed; differences appear as `""`. Color compares the actual document
ink, so inherited black and explicitly assigned black show the same RGB value.
Set `appearance.color` through its swatch, RGB, or hex to recolor all
selected components, including different types. For one component type, edit
`parameters.value` (or individual parameters such as MOS `w` and `l`) together.
Blank parameters keep each component's existing value. The `symbol` field
shows the common type; it is blank for differing types and is informational.
Each valid code edit applies atomically and can be undone once. Invalid edits
keep the last accepted drawing. Changing selection discards its pending draft.

## Label names and typography

Double-click a bound label to edit its text and formatting. Labels default to
bold italic. Bold, italic, upright text, color and superscript remain
independent of the electrical name; changing a name preserves those choices.
`Use display alias` is off by default. Enable it only for a canvas-only name.

An underscore introduces a subscript: `M_1` is displayed as M₁, while `M1`
stays on the baseline. Applying or removing subscript in the text editor adds
or removes the underscore in the netlist name. Netlist edits update the label
in the other direction. Historical explicit label formatting is preserved on
open; editing that label's text adopts this naming convention.

An overbar on a bound name uses the suffix `_bar`: F with a bar is `F_bar`,
and a barred F with subscript in is `F_in_bar`. Applying or removing the bar
updates the netlist. A source name ending in `_bar` renders with an overbar;
removing that suffix when renaming the source removes the bar. Subscript case
changes leave this reserved suffix as `_bar`. Free text and explicit display
aliases remain presentation-only.

In **Properties** code, `labels.subscript_case` accepts `preserve`, `uppercase`
or `lowercase`. Valid edits apply immediately. Changing it renames existing underscore suffixes
and historical explicit rich-text subscripts in both labels and the netlist for
the current Cell, in one undoable change. Plain names without subscripts stay
plain. `labels.subscript_italic` accepts `true` (italic) or `false` (upright),
changes only the subscript slant, and preserves names, color and weight.
Individual labels remain freely editable afterwards. The choice is
stored in Project Code, not as a browser-wide preference. `preserve` leaves
current spelling alone; use Undo to restore an earlier spelling. Same-name Nets
and Pins denote one electrical connection. Instance names must remain unique:
a collision keeps the draft open and suggests `Use display alias` in the status
bar, without opening a blocking dialog.

## Arrow styles

Choose **Arrow** in the Library's **Annotations** group. A new arrow is a line
arrow with a filled end head: click each bend in sequence and double-click or
press `Enter` at the endpoint; it can later be curved. Change its endpoint
styles, or turn a straight arrow into a hollow outline, in Properties.

Arrow and construction-line points snap quietly to nearby pins, wires and
drawing geometry, including any point along a rectangle, circle, line or curve.
Only the transient capture marker is shown; no snap points are added to the
drawing. Hold `Alt` to suppress snapping. A visual snap aligns coordinates but
does not create electrical connectivity or make one drawing follow another.

Select any annotation and press `Q`, or use its right-click Properties action,
to edit its JSON. Placement and appearance come first; text content (including
rich text runs) follows geometry and stacking. Valid edits update immediately
as one undoable edit. Invalid or locked edits retain the last accepted drawing;
**Discard draft** restores the current code. Semantic labels retain their
electrical text bindings; their code changes presentation only. Values with a
fixed set of choices have a small dropdown arrow beside the JSON value: line
style, arrow endpoint styles, layer, text alignment/weight, visibility and locking.
The menu shows the available choices without repeating the selected value.

For arrows, `appearance.startStyle` and `appearance.endStyle` independently
choose `small-arrow`, `medium-arrow`, `large-arrow`, `dot`, `none`, or
`open-arrow`. Each value has its own dropdown. Start and end follow the first
and last points of the path when it rotates or mirrors. `appearance.arrowShape`
chooses a line shaft or a straight outline silhouette; existing curves must be
straightened before switching to outline.
`appearance.strokeScale` changes stroke weight; an outline's `geometry.width`
changes its shape without changing weight. `placement.rotation` is a clockwise
angle in degrees: 0° points right and 90° points down. For a bent line it is the
direction of the first segment; changing it rotates the whole path. The menu
offers common 45° angles; rectangles and paths also accept custom angles in
code, while text uses 45° steps. `geometry.tangentAngles` sets the curve angle
for each segment.
Endpoint, width and rotation handles remain available on the canvas.

Rectangles and circles have independent `appearance.color` (border) and
`appearance.fillColor`. Click either color swatch for presets or RGB input;
hex and `[R, G, B]` are also accepted in code. `"auto"` inherits the document
border color and makes the fill transparent. `stacking.layer` selects
`"back"` or `"front"` relative to circuit artwork. The numeric drawing order
is managed internally; **Bring to front** and **Send to back** place a shape
above or below other drawings. Width, height and radius live in `geometry`.

Existing head sizes remain intact when loading or restyling old drawings.
Converting a bent/curved line arrow to an outline is disabled: no bends are
discarded. Changing a selected object's style does not change the next-object
creation default. These are non-electrical drawings, separate from current
markers attached to conductors and arrows inside device symbols.

## Save and recover

**File / Save** (or `Ctrl+S`) saves the current content to one private Cloud
Project. Repeated saves update that Project instead of creating snapshots. A
new or imported drawing is unbound until its first Save, which creates and
binds its Cloud Project. A dot beside the Project name means
the Cloud Project has unsaved changes. Browser Back, Refresh, and tab or window
close then show the browser's standard leave warning; only an acknowledged
Cloud Save of the current content clears it.

Edits also stage an origin-local IndexedDB recovery copy. Recovery is silent
crash protection, not Save, and can be lost if browser site data is cleared.
If Cloud is unavailable, continue editing normally and use **Export Project
File…** when you want a portable copy. A direct **Download Backup** action is
shown contextually if browser recovery itself cannot protect current work.

New, Open, Revert, and the same-tab trip to Gallery ask whether to **Save to
Cloud and continue**, **Continue without saving**, or **Stay** when the current
Project is dirty. The prompt also identifies where each explicit save goes:
Cloud Save keeps the Project in your private Cloud Projects, up to the
per-account limit the prompt shows, while **Export Project File…** downloads a
local `.icproj.json` file. Continue without saving
means discard: that working copy is removed before the action
continues. If a newer
unsaved recovery copy is found on a later start, a small banner offers
**Restore**, **Download backup**, or **Ignore**. The same copies remain
available through **File / Recover Local Work…**; recovery never silently
replaces the current Project.

Returning from Gallery reopens the last active Cloud Project for this browser
tab. The tab stores only that Cloud Project id; the editor fetches the formal
Project again rather than treating browser state as Save. A newer unsaved
recovery copy still gets the first decision.

Use the Cloud Projects list in **File** to open formal work. Use **Import
Project File…** to validate a portable `.icproj.json`; invalid or future-version
input leaves the current Document unchanged. **Export Project File…** does not
change Cloud save state. The old rolling cloud
snapshot and local File System Access Save paths have been removed.

### Project Code and custom components

Open **Project Code** from the top toolbar to edit the complete Project. Copy
all of its JSON into another editor's Project Code and choose **Apply** (or
press Ctrl/⌘ + Enter) to reproduce the drawing, including its component
definitions. The receiving editor keeps its own Project identity and Cloud
binding. Apply is undoable; invalid code leaves the live drawing unchanged.

To edit one component, select it and press **E**, or right-click and choose
**Edit Component Definition**. **Q** continues to edit instance properties.
The definition workspace shows code and a live, isolated preview with pin
coordinates. It does not provide mouse drawing tools. **Save & apply** publishes
a new shared component and changes only the selected instance; peers retain
their existing definitions. It supports normal Project Undo. A hierarchical
Cell still uses **E / Enter Cell** to navigate into its circuit.

The Library ends with **User Defined**, after **Extended Devices**. Choose
**Create component**, edit the starter code, and **Save & place**. Signing in
is required to save; every saved definition is public, with no private-library
option. Other people can place it or fork it as a new component. Authors can
update their own library entries; each revision is captured independently
when placed, so updates never silently rewrite existing drawings.

Administrators can mark an entry **Official**, delete it from the public list,
or restore it using the **Deleted** filter. Official entries can be updated
only by an administrator; anyone may fork them. Deletion retains the stored
definition, and circuits that already contain it remain complete and usable.
Official here means an administrator-reviewed public library entry, not an
automatic change to the repository's built-in component files.

Custom component artwork is also editable through complete Project Code. Find its entry in
`componentDefinitions`: `symbol` contains the shapes and pins, while
`electrical` and optional `subcircuit` describe its netlist interface. Edit the
included definition and apply it to update every instance that references its
`symbol.id`. There is no mouse editor for the component's internal shapes.
Ordinary canvas placement, rotation, mirroring and circuit wiring remain
available and do not rewrite that shared definition.

To customize just some instances, copy the definition, give `symbol.id` and
any included `electrical.symbolId` / `subcircuit.symbolId` the same new ID, and
set those instances' `symbolId` to that ID in the same edit. Keep pin names and
electrical pin order unchanged when only adjusting artwork. A moved pin keeps
its identity; existing route geometry may need a manual adjustment.

The Project carries one definition per used component type, including uses in
other Cells. Deleting its final use removes the definition; Undo restores it.
Unused definitions inside a Project are not a component library. When editing
through Project Code, keep a placed instance while developing a definition.
The User Defined library stores published definitions independently. An Agent can make
the same changes in the complete Project code without a separate file format.

SPICE files are import inputs, not embedded source attachments. Saving an
imported Project preserves the editable schematic and source provenance, but
does not preserve `.spi`, `.lib`, or `.inc` contents; keep those original files
when you need to import them again.

## Export

**File / Export drawing** exports the entire current drawing as SVG, PNG, or PDF containing only formal schematic
layers. PNG uses 3x raster scale. Browser PDF converts the same formal SVG to
vector paths and text on a page matching the SVG viewBox, so circuit geometry
stays sharp when enlarged.

To reuse only selected content as an image, choose **Edit / Copy selection as
PNG** or **Edit / Copy selection as SVG**, then paste into another application.
Attached visible labels travel with their selected objects, but remote objects
sharing a Net do not. Clipboard copies omit editor overlays, use a transparent
page background, and do not change the circuit or Undo history. PNG is rendered
at 3x with a bounded image size. SVG stays vector; formula glyphs remain paths,
and the receiving application determines paste/editing support. Clipboard writes
require HTTPS or localhost and browser permission. Failures are reported without
silently downloading a file or substituting a different format. These commands
remain separate from editable circuit copying with **C** (immediate placement)
or **Ctrl/Cmd+C**, then **V** / **Ctrl/Cmd+V**.

Use **Netlist / Check and Save** to check the whole Project for ERC and
visual issues and save it through the existing private Cloud Project service.
Findings appear in **Issues**, the bottom status summary, and existing canvas
markers. Observations stay behind their explicit toggle. Neither producer
runs automatically while drawing. Further edits mark the last check out of
date and hide its markers; check again to refresh it. Save still proceeds
when issues exist, and an offline or signed-out save still leaves the local
check available. This command does not repair Bulk connections or rewrite
the circuit. A Route segment that is neither horizontal, vertical, nor exactly
45° appears as an actionable wiring issue. **Straighten angled wires in this
Cell** replaces only those segments with local right-angle corners in one
undoable edit; intentional 45° segments stay unchanged. Locked and trunk Routes
remain listed for manual repair. **File / Save** and **Ctrl+S** remain save-only.

Click the top **Netlist** copy button to put the netlist on the clipboard and
open its live code in the right sidebar. That panel's **Format** (SPICE or SCS)
and **Process** selectors are independent. The editor starts in SKY130, and a
transistor you draw is bound to the selected process as you place it. Choose
Abstract, SKY130, TSMC 28, TSMC 180 or Custom, then optionally choose
NMOS/PMOS/R/C/L targets below the code. Process changes update the circuit and
can be undone; existing values are retained. Unbound native devices use the
cached template's defaults when the panel opens. **Default** restores the
mapping the editor starts in and output preferences. An older circuit whose
devices have no model shows **Fill N devices** beside it: one undoable click
gives exactly those devices the selected process's model and dimensions, and
leaves every value you authored alone. The code area is as tall as the netlist,
up to the room the sidebar has, and scrolls inside itself beyond that.
The selected templates, format and port-name case are remembered in this browser.
Editing the circuit refreshes the visible code. Clipboard failures leave the
code selectable for manual copy.

**Netlist / Instances…** opens the Project's netlist instances as one editable
JSON document in the right sidebar. Paste whole blocks to change references,
model bindings and parameters together. Outer keys are Cell IDs; inner keys are
stable instance IDs. Edit `reference` to renumber, `target` for the typed model
binding, or `parameters` for values. `symbol` is read-only. Omitted instances and
fields remain unchanged; a supplied `parameters` object replaces that instance's
parameter set, so deleting a parameter clears it. Valid edits apply together;
invalid JSON or conflicting references leave the circuit unchanged. **Edit / Undo**
and **Redo** undo or restore the complete batch.

**Netlist / Configuration…** opens one raw JSON document in the right sidebar.
Copy, paste, or replace the whole configuration. Set `selected` to `abstract`,
`sky130`, `tsmc28`, `tsmc180`, or `custom`; edit the corresponding entry under
`profiles`. Valid edits apply immediately and are remembered in this browser.
Invalid JSON pauses copying until corrected. The circuit itself is unchanged.

- `abstract`: ideal R/C/L and generic NMOS/PMOS model names, with editable
  fallback values and dimensions. No transistor model cards are invented.
- `sky130`: real SKY130 transistor wrappers, with ideal R/C by default. For
  physical R/C, set the target to `sky130_fd_pr__res_high_po` or
  `sky130_fd_pr__cap_mim_m3_1` and supply `w`/`l` in metres (for example `5u`),
  plus `mult` or `mf`. The resistor's `substrate` defaults to `0`. Ideal values
  are not converted into geometry. Set `library.path` and `library.section`
  for your installed PDK. SCS exports stay in Spectre syntax and reference that
  configured path with a native `include` declaration.
- `tsmc28` / `tsmc180`: TSMC reference MOS names (`nch_ulvt_mac`/`pch_ulvt_mac`
  with `multi`, or `nch`/`pch` with `m`) and ideal R/C/L. Point `library.path`
  at your installed PDK.
- `custom`: keep authored component targets, and fill missing fields from your
  editable defaults. Existing component values always take priority.

Every preset requires an actual MOS Bulk connection or an explicit NoConnect.
Missing connections block export rather than creating an invisible VDD Net.
Built-in Analog Blocks require their library-declared supply Nets to exist;
export reports missing supplies instead of adding Cell Pins. Use an explicit
external definition when the block needs a different supply interface.

Fields still missing after these defaults block netlist output; the sidebar and
Check Report identify the exact device and field. Refresh applies configured
defaults in one undoable Project change. Existing values, connections, and
formal pin order are retained.
Copied code contains no generated comments; detailed findings remain in Check
Report. SPICE keeps an empty first title line so a simulator does not consume
the first directive. An explicitly marked NoConnect becomes a floating node
such as `NC0001`; structural errors such as an unmarked non-bulk open pin,
conflicting names, or unsupported devices show an error instead of stale or
partial code.

Choose the arrow beside Netlist, then **Check Report** to inspect the same
SPICE/Spectre preview, change the naming profile, or navigate to a finding.
The report lists structural findings and current-revision ERC readiness
separately. The export includes the library path/section you configured, but does
not add model cards, analyses, or a complete testbench. Exporting a file does not
make the circuit ready for simulation.

## Import Spectre / SCS

Use **File / Import SPICE / SCS…** and select one `.scs` entry together with
its local include files. `circuit.scs` is recognized as the entry when several
netlist files are selected. Conversion happens in the browser and works locally.
The converted structure uses the existing import and placement flow. Errors
show the source filename and line, and leave your current circuit unchanged.

The converter supports common structural devices, ordered subcircuits, parameters,
DC/AC/PULSE/SIN/PWL sources and simple OP/AC/DC/TRAN analyses. It preserves a
SPICE-language section in SCS. Unsupported parameters, native model syntax,
behavioral expressions and ngspice control scripts cannot be translated into
native Spectre; they produce an error instead of a partial circuit. Simulation
source folders remain the place for complete original testbenches. See the
[SPICE compatibility guide](spice-compatibility.md) for the current import and
export support matrix.

## Finding duplicate circuits

Administrators can click **Check duplicates** at the bottom of the Community
Gallery's left column to scan every public circuit, independently of the current
search, author or tag filters. The control is not shown to other users. The scan
runs in a cancellable background worker. Results show duplicate groups with
previews and links, the number of extra copies (a group of three contributes
two), and badges on matching Gallery cards. The entry point is hidden for
visitors and ordinary members.

Each group selects the oldest publication to keep; choose another copy if
preferred. **Keep selected, remove…** cleans one group, and **Remove all extra
copies** cleans every listed group using those selections. Removed copies go
to the admin recycle bin with their project, likes and version history intact.
They are exempt from automatic author recycle-bin limits and can be restored
from **Open recycle bin**. The server requires an administrator and rechecks
the current electrical netlists before changing anything in a group. If a
group changed or cannot be compared, it stays untouched and shows an error;
other groups can still succeed. Results are a snapshot; scan again after
library changes.

Comparison uses the extracted electrical netlist, not titles or drawing JSON.
Instance names, internal node names, drawing positions and instance order do
not matter. Device classes, models, values, terminal roles and the ordered
external port contract do. Equivalent numeric spellings such as `1k` and
`1000` match. Unset model/value fields match only the same unset fields, with
NMOS and PMOS kept distinct. The check does not apply a viewer's PDK preset or
claim that externally supplied models have identical implementations.

Simple hierarchy is expanded for comparison. Parameterized hierarchy,
behavioral references, circuits without usable connectivity, and comparisons
that exceed bounded computation are listed under **Unable to compare**, with
a reason; they are never silently classified as unique. Candidate summaries
only narrow the search: duplicates require an exact electrical graph match.

## Portable release

Build the versioned bundle and start it with Node 24:

```powershell
pnpm release:package
node output/release/interactive-circuit-maker-v0.9.2/start.mjs
```

Open `http://127.0.0.1:4173`. Chromium can install the app from its browser
install action. The server accepts only loopback connections.

## Deployment

The editor is served by the Production Cloudflare Worker in `worker/`. A merged
non-documentation pull request deploys through
`.github/workflows/cloudflare.yml`; a `v*` release tag or explicit dispatch may
redeploy a selected commit already on `main`. The Worker hosts the built editor
and the gallery, account, Agent-session, and simulation endpoints behind it;
see [deployment](../deployment.md). The former hosted Preview site is offline,
with its isolated data retained but unreachable.

The private Cloud Project is the formal saved copy. Exported `.icproj.json`
and downloaded backups remain portable user-owned copies. Browser recovery is
specific to one browser profile and may disappear when site data is cleared;
publishing to the Gallery is a deliberate, separate act rather than a backup.

Before a public release, verify opening, refreshing, importing and exporting,
browser recovery, and PWA installation at the deployed URL.

## Gallery version history

Open your Gallery entry, choose Publish, then **Version history**; your entries
also offer this action on **My submissions**. The current publication and up to
three previous snapshots are retained. Every update and restore snapshots the
previous state; older snapshots are pruned.

- **Compare** shows the historical and current published circuits side by side.
  Added components are green, removed ones red, and modified ones amber. Click a
  highlight or component row for parameter, placement, name and connection changes.
  Choose a Cell to inspect a child circuit. The comparison does not edit the canvas.
- **Branch** opens the complete historical Project as an independent draft. Save
  it to create a new Shelf project; the original publication and draft are unchanged.
- **Restore** updates the original publication while preserving its link and likes.
  The pre-restore current version becomes a historical snapshot.

History is available to the author and administrators/moderators. Previously
pruned versions cannot be recovered by the new three-snapshot limit. This is a
small publication history, not a full Git merge system or private Shelf timeline.
