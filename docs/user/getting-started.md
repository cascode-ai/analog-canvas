# Getting Started

## Run from source

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm dev
```

Run `pnpm build` again after pulling package changes, then open the displayed
loopback URL. The editor starts with an empty `New Circuit` Project whose one
Cell is `dut`; nothing needs to be opened first.

To start from a netlist, choose **File → Import SPICE / SCS…** and select one
`.cir`, `.sp`, `.spi` or `.scs` entry plus its local include files.
**Import Cadence SPICE (`!` globals)…** also treats net names ending in `!` as
global Nets. Imported parts start in the **Placement Tray** so you decide the
layout.

## The editor

The header has **File**, **Edit** and **Circuit** menus and the **Simulate**,
**Agent** and **Publish** actions. **File** holds Project Info (circuit and
Cell names) and the file commands; **New Project** replaces the current tab's
circuit after asking about unsaved work. **Circuit** holds **Hierarchy** (Cell
Manager) and **Netlist**.

Each project tab is an independent circuit with its own view, selection, undo
history and Cloud binding. Use **+** for a new project, **Open file in new
tab**, or **Open Shelf project in tab**. Double-click a tab's name to rename
it; right-click it for **Close**, **Close Others** and **Close All**. Refresh
restores this window's tabs and unsaved circuits (not Undo stacks); after
closing the browser tab, a new editor tab offers **Reopen tabs**. This
browser-local workspace is not a backup: save or export what you need.

## Draw and connect

- Open **Library** to pick a symbol, or press `I` to search the whole
  library, then click to place. The **Placement Tray** holds imported or
  returned parts: drag one out, use **Place…**, or **Place all**. **Return to
  tray** is undoable and different from Delete.
- Click to select, `Shift`/`Ctrl`-click to add, drag on blank canvas to
  box-select. Dragging a selected part moves the whole selection; wires inside
  it move along and only wires leaving it stretch.
- `R` rotates, `Shift+R` mirrors left/right and `Ctrl/Cmd+R` top/bottom (also
  on the right-click menu). Everything selected mirrors together, wires alone
  included, with every connection kept; mirroring again restores it.
- Press `W` (or **Wire**) and click pins, Junctions or wire segments. Click
  blank canvas to add bends; double-click or press `Enter` to finish,
  `Backspace` removes the last bend, `Esc` cancels. Crossing a wire does not
  connect; ending on one adds a Junction. Middle-click (or `/`, or the Wire
  chip in the status bar, `F3`) cycles the corner shape: opposite right angle,
  45°, any angle, automatic right angle.
- A wire end near a drawn rectangle's edge snaps to its third, middle or
  two-thirds point; the box is drawing only and connects nothing.
- Select a wire segment and drag its handle to move just that segment. Landing
  exactly on a pin connects it. **Delete wire** removes that electrical branch
  and can split its Net. Right-click a wire end for **Disconnect endpoint** or
  **Delete connection**.
- `Delete` on a connected part also removes wires that only tapped it; a wire
  running on to another part, or carrying a Net label, stays open so a
  replacement reconnects. Open wire ends appear in Issues.
- Copy: select parts and wires and press `C`; the copy follows the pointer
  until you click (more clicks place more copies, `Esc` stops). With nothing
  selected, press `C`, then click a part. `C` then clicking another tab places
  it there; `Ctrl/Cmd+C` and `Ctrl/Cmd+V` work across tabs and windows, and `V`
  places the last copy again. A copy keeps its internal wiring and labels but
  no outside connection, takes fresh names where needed, and looks like its
  source; **Use this drawing's style** under **Copied style** in Properties
  adopts the destination's style.
- `Ctrl`+wheel zooms, middle-drag pans, `F` fits, `Ctrl+Z` undoes, `Ctrl+Y` or
  `Ctrl+Shift+Z` redoes. Shortcuts do not fire while typing.

## Properties

Select a part and press `Q` to edit it as JSON: parameters, `displayName` (the
drawn label), `netlistName` (the exported instance name), netlist target,
`"coordinate": [x, y]`, rotation, mirror (`"horizontal"`, `"vertical"`,
`"both"`), label visibility and color. Inline controls beside values offer
rotate/mirror buttons, visibility switches, a target selector, unit hints and
a color picker (presets, `[R, G, B]`, hex, or `"auto"` for document ink).
Values are strings: type unit suffixes yourself (`2u`). `Enter` confirms,
`Shift+Enter` adds a line. Valid edits apply at once and are undoable; invalid
text keeps the last accepted drawing. The header has **Defaults** (restores
default values without moving or renaming), **Copy JSON** and **Discard
draft**. Drag the panel's left edge to resize it.

Differential-input blocks have `appearance.inputsSwapped` (and fully
differential amplifiers `outputsSwapped`) to exchange the +/− positions;
connections follow their pins.

For a MOS, the **Bulk** row shows the body's Net or **Unconnected**; **Connect**
draws a dashed body wire from the bulk terminal. Netlists and simulation use
real Bulk connections, including placement defaults; connect a missing Bulk or
mark it NoConnect.

A drawing that needs a supply it does not draw (an unconnected MOS body, a
logic gate or converter whose model reads VDD and VSS) gets a `VDD` Pin and
ground in the netlist, never on the canvas. A comparator's output swings to
its own VDD unless `vhigh` is a number. An op-amp clips at its own supplies
once a VDD is drawn or selected (`vhigh` `VDD`, `vlow` `VSS`), else at ±5 V;
numbers set fixed limits. With several supplies to choose from, pick the
block's VDD or VSS in Properties; a warning says which limit falls back.
Built-in analog blocks have `supplies.VDD`/`supplies.VSS` selectors (empty is
**Auto**: the one drawn positive supply or ground). Explicitly Global supplies
stay global.

### Editing several parts

Select parts and press `Q` for one JSON block. `name` shows the common name or
`as is`; writing one name gives it to the part that has it (else the first
selected), and the others show it as a display alias. Shared parameters are
listed one entry per part; write one value to set them all (blank keeps each
value). Colors and switches show one value where the parts agree. Each edit
applies atomically with one undo; changing the selection discards a draft.

## Labels and text

Select a part to edit its displayed name. Select a wire to add a Net label
(`L`); the same name on another Net connects the two. Press `R` while placing
or with labels selected to turn a Net label a quarter. Press `T` (**Text**)
for a non-electrical note; notes and text in drawn boxes default to bold (use
**B** for normal weight).

Double-click any label or block text (an ADC, a transfer function) to edit it
with italic, bold, subscripts, superscripts and overbars. **Insert fraction**
(a-over-b) stacks a fraction: type the numerator, `Tab` to the denominator,
`Tab` to continue the line. **ƒx** enters a formula such as
`\frac{1}{g_{mN}} + R_1`. **Ω** inserts Greek letters and circuit symbols, or
type a LaTeX name (`\phi`) and press Space. In names the netlist spells the
letter out in matching case: φ₁ is `phi1`, Φ₁ `PHI1`, Ω `OMEGA`.

### Label names and typography

A label's name and its look are separate. The name, used by the netlist,
simulation and Agents, is exactly what you typed; subscripts, overbars, slant
and weight only change the drawing (see
[names and labels](../specs/names-and-labels.md)). Labels default to bold
italic. If what you type cannot be the part's netlist name (a Greek letter, a
space, another part's name, the wrong first letter), **Use display alias**
turns on: the label shows your text and the netlist keeps the name, as the
status bar says. A Cell Pin's alias is drawn at the Pin and on the Cell's
block in every parent.

New labels start in a standard look:

- VDD power and VDD rails: V_DD (`VDDH`, `VCC` likewise; `AVDD` as written).
- Device names: italic letter over an upright subscript (M₁, R_L, C_L);
  subcircuit `X` names keep their letters over an index (XU₀).
- Pin and Net names `V…` or `I…` followed by letters or digits (`Vin`,
  `VBP`, `Iout`): italic V or I with an upright subscript. `IN`, `INP`, `IO`,
  `CLK`, `OUT` and other names are shown as written.

Renaming keeps a standard look in step; once you restyle a label your
formatting is kept (select `BP` in `VBP` and turn Subscript off). Subscripts
are upright unless you make them italic. Older unformatted labels draw `M_1`
as M₁ and `_bar` as an overbar. An overbar on a Net or Cell Pin label names
its complement (`D_bar`).

With nothing selected, **Properties** shows the drawing's `labels` settings,
applied to existing labels at once and undoable:

- `underscore_subscript`: draw `A_1` as A₁ (or literally);
- `subscript_after_first`: draw each name's first letter over a subscript of
  the rest (off by default);
- `subscript_case`: `preserve`, `uppercase` or `lowercase` (also changes
  netlist spelling of underscore suffixes);
- `subscript_italic` and `first_letter_italic`.

## Drawing shapes and arrows

**Arrow** is in the Library's **Annotations** group: click each bend, then
double-click or press `Enter`. Arrow and construction points snap quietly to
pins, wires and shapes (hold `Alt` to stop); snapping never connects anything.
Select a shape and press `Q` to edit its JSON: endpoint styles
(`small-arrow`, `medium-arrow`, `large-arrow`, `dot`, `none`, `open-arrow`),
`arrowShape` (line or outline; straighten curves first), `strokeScale`,
`placement.rotation` (clockwise degrees, 0° right), `tangentAngles` for
curves, border `color` and `fillColor`, and `stacking.layer` (`"back"` or
`"front"`; **Bring to front**/**Send to back** reorder). Values with fixed
choices have a dropdown. Shapes are drawing only.

## Save and recover

**File → Save** (`Ctrl+S`) saves to one private Cloud Project, updating it on
each save; a new or imported drawing creates its Cloud Project on first save.
A dot beside the name means unsaved changes, and leaving the page warns. Your
Cloud Projects are on your account page and in the tab bar's ▾ Shelf.

Edits are also kept as a browser recovery copy (not a save; clearing site data
loses it). If a newer unsaved copy is found at start, a banner offers
**Restore**, **Download backup** or **Ignore**; **File → Recover Unsaved
Work…** lists copies. Without Cloud, keep working and use **Export Project
File…** for a portable `.icproj.json`. New, Open, Revert and going to the
Gallery ask to **Save to Cloud and continue**, **Continue without saving**
(discards that working copy) or **Stay**. Returning from the Gallery reopens
the last Cloud Project of this tab. **Import Project File…** opens a portable
file; invalid or future-version files leave your work unchanged.

**Privacy** (status bar and account menu) explains what the site keeps;
**Stop counting me**, Do Not Track or Global Privacy Control refuse the visitor
cookie. **Delete account…** removes your account, Cloud Projects, published
circuits, shared components and likes and cannot be undone; export first.

SPICE files are import inputs: a saved Project keeps the schematic and source
provenance, not `.spi`, `.lib` or `.inc` contents. Keep the originals.

## Project Code and custom components

**Project Code** in the toolbar edits the whole Project as JSON; paste it into
another editor's Project Code and **Apply** (`Ctrl/⌘+Enter`) to reproduce the
drawing and its component definitions. Apply is undoable; invalid code changes
nothing. Selecting parts highlights their JSON.

To edit a component's definition, select it and press `E` (`Q` still edits the
instance). **Edit → User Components… → Create Component…** opens the
**Circuit** and **Symbol** tabs: enter SPICE or Spectre (or choose a Project
source), use Automatic or Custom JSON artwork, and map each native terminal to
a pin or to VDD/VSS. **Apply model** changes the Project in one undoable step;
**Place** applies first; **More → Save draft** keeps unfinished work (even
invalid text) in the Project. See [schematic hierarchy](schematic-hierarchy.md)
for external models.

**Publish** shares an applied definition publicly (sign-in required) with its
source, owned helper files and artwork, not drafts or testbenches. Authors and
administrators update their records; others use **Publish as new component**.
Placing a public component captures it in your Project, so later library
changes or deletion never alter your circuit. **Needs repair** cards show why
an old definition no longer validates; **Copy raw record** and repair it in
**Create Component**. **Refresh** reloads the public list. Administrators can
mark entries **Official**, delete them or restore them from **Deleted**.

Custom artwork can also be edited in Project Code under
`componentDefinitions` (`symbol` shapes and pins; `electrical` and
`subcircuit` interface); applying updates every instance using that
`symbol.id`. To change only some instances, copy the definition under a new ID
and point those instances' `symbolId` at it in the same edit. A Project keeps
one definition per used component type; deleting the last use removes it.

## Netlist and export

**File → Export** saves the whole drawing as SVG, PNG (3×) or vector PDF.
**Edit → Copy selection as PNG/SVG** copies the selection as an image with a
transparent background (needs HTTPS or localhost and clipboard permission).

The **Netlist** button copies the netlist and opens its code in the right
sidebar. **Format** (SPICE or SCS) and **Process** (Abstract, SKY130 by
default, IHP SG13G2, TSMC 28, TSMC 180, Custom) are independent; a transistor
you draw takes the selected Process's model. Process changes are undoable and
keep your values. **Fill N devices** gives older unbound devices the Process's
model and dimensions in one undoable step. Choices are remembered in this
browser. Missing fields block output, and the sidebar and **Check Report**
name the device and field. Export never adds model cards, analyses or a
testbench.

**Netlist → Configuration…** edits the Process presets as JSON: `selected`
(`abstract`, `sky130`, `sg13g2`, `tsmc28`, `tsmc180`, `custom`) and its entry
under `profiles`.

- `abstract`: ideal R/C/L and generic NMOS/PMOS names.
- `sky130`: SKY130 transistor wrappers, ideal R/C unless you target
  `sky130_fd_pr__res_high_po` or `sky130_fd_pr__cap_mim_m3_1` with `w`/`l` in
  metres; set `library.path` and `library.section` for your PDK.
- `sg13g2`: IHP SG13G2 devices as its xschem symbols name them
  (`sg13_lv_nmos`/`sg13_lv_pmos`, `sg13_hv_*`, HBTs `npn13G2…`, `pnpMPA`;
  `rsil`, `rppd`, `rhigh`, `cap_cmim`, `cap_rfcmim` for physical R/C). Include
  the PDK's ngspice libraries and OSDI modules yourself.
- `tsmc28` / `tsmc180`: TSMC reference MOS names; point `library.path` at your
  PDK.
- `custom`: keeps your targets and fills missing fields from your defaults.

**Netlist → Instances…** edits every instance's `reference`, model `target`
and `parameters` as one JSON document, applied together with one undo.

**File → Check and Save** checks the Project (ERC and visual issues) and
saves it; findings appear in **Issues** and on the canvas until you edit
again. **Straighten angled wires in this Cell** fixes non-45° segments.

Switches (**Open**, **Closed**, **Simple**) are clocked by the phase their
label names: write `Φ₁` on several switches to share a clock, and drive it
with a Net or Cell Pin named `Φ1`; an undriven phase becomes a Cell input. An
overbar (`E̅N̅`) names a separate signal `EN_bar`. **Ctrl SW** uses its CTRL pin.
Diodes without a model use a generic `DIODE` card, and NPN/PNP in Abstract or
Custom generic `NPN`/`PNP` cards, until you choose a model or define one in
your simulation files.

## Import Spectre / SCS

**File → Import SPICE / SCS…** also takes a `.scs` entry with its includes
(`circuit.scs` is preferred among several), converted in the browser. Common
devices, subcircuits, parameters, DC/AC/PULSE/SIN/PWL sources and simple
analyses are supported; anything else is an error with file and line, never a
partial circuit. See [SPICE compatibility](spice-compatibility.md).

## Gallery

Open your Gallery entry, choose Publish, then **Version history** (also on
**My submissions**): the current publication and up to three earlier
snapshots. **Compare** highlights added (green), removed (red) and changed
(amber) components per Cell; **Branch** opens a version as an independent
draft; **Restore** republishes it, keeping link and likes. Private Shelf
projects have their own **Version history** (see
[private save history](../specs/persistence-and-recovery.md#private-save-history)).

Administrators can run **Check duplicates** at the bottom of the Gallery's left
column. It compares extracted electrical netlists (not names, layout or
order), lists groups and **Unable to compare** entries with reasons, and
**Keep selected, remove…** or **Remove all extra copies** moves extras to the
admin recycle bin after rechecking them.

## Portable release

```powershell
pnpm release:package
node output/release/analog-canvas-v0.9.2/start.mjs
```

Open `http://127.0.0.1:4173` with Node 24; Chromium can install it as an app.
It accepts only loopback connections.
