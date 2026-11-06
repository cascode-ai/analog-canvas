# Schematic hierarchy

Every Project Document is a reusable schematic Cell. The top Cell is the
saved default entry; other Cells can be placed any number of times or left
unreferenced while you work on them. The top Cell can itself be placed in
another Cell, as long as no recursion results.

## Hierarchy tree

Open **Hierarchy** in the toolbar or **Circuit → Hierarchy → Show hierarchy
tree**. Every Cell that nothing calls is a root, and its rows expand actual
instance occurrences to any supported depth. Each row shows the instance
reference and its Cell name; **×N** counts a shared Cell's uses and lists them
under the row. Type in the filter to find Cells and instances. Roots keep
their order while you work: Top first when the Project opens, and Cells that
become roots later at the end. The root you work in stays expanded down to
where you are. Every Cell command is in the tree. **Edit → Place Cell from this
Project…** also lists the Cells you can place.

- Click a row, double-click a canvas instance, or press **E** to enter it.
  Inside a Cell the canvas shows the exact instance path: **↑** / **Shift+E**
  returns to the caller and selects that instance, a crumb opens its level,
  and **Top** opens the saved default. At a root no path shows. Navigation
  fits the drawing as **F** does and does not edit the circuit.
- Hovering a row shows its icons, described below. Drag a row onto the canvas
  to place its Cell once. Double-click a row or press **F2** to rename its Cell.
- Right-click a row, or press the Menu key or **Shift+F10** on it, for **Open
  definition** (no parent path; choose a concrete use to resume occurrence
  navigation), **Show uses**, **Set as Top**, **Delete Cell** and, on a use, the
  commands in [Reshaping the hierarchy](#reshaping-the-hierarchy). Delete removes
  only an unused, non-top definition; deleting an instance never deletes its
  Cell. A refused command says why under it.
- **TOP** marks the Top Cell wherever it shows. Hover another row and click its
  dashed **TOP**, or use **Set as Top**, to make that Cell the saved default
  entry. It is undoable, moves no row and does not change the editing path,
  explicit netlist Entry or a simulation's Cell.
- **+** in the tree header creates an unplaced Cell and opens it. **+** on a row
  takes a name and Pins, typed or pasted, with directions guessed from their
  names and changed with a click, then previews the block in that Cell.
  Clicking creates the definition, interface and caller in one undo step and
  enters the child. **Esc** before placement leaves no Cell.
- **Place** on a row reuses an existing definition with normal placement
  controls (`R`, mirror, `Esc`). Self-instantiation and cycles are refused
  with a reason.
- **Cell properties** on a row opens the Cell's one sheet: see [Cell
  Pins](#cell-pins) and [Cell parameters](#cell-parameters).
- **Import Cell…**, in the tree footer, copies a Cell from another Cloud Project
  with its children, compatible external models and presentation in one undo
  step and opens it. The copy is independent; repeating the import opens it.
  Symbol Library versions must match.

Tree expansion and instance paths are remembered per Project tab and after a
refresh. If an edit removes part of the current path, navigation returns to
the nearest surviving parent. Renaming a Cell does not change the path.

### Reshaping the hierarchy

These commands are on a use's row menu in the tree; **New child Cell from
selection…** is on the menu of any row of the open Cell while parts are selected
on its canvas. Each is one undo step.
One that edits a Cell with several uses says so under the command and in its
dialog before it runs, and in the status line after.

- **Make unique copy** gives one instance its own copy of its Cell (`Amp_2`),
  with the same Pins and the same Cells below.
- **Replace Cell…** switches this use, or every use of the Cell, to another Cell
  with the same Pin names. Other Cells are listed with the Pins they lack or
  add; cycles are refused.
- **New child Cell from selection…** moves the selected parts into a new Cell.
  Each Net that leaves them becomes a Pin, parent parameters they use pass
  through, and a block takes their place. A selection may not split an
  inductor coupling.
- **Flatten into ⟨parent⟩** puts the child's parts back into the parent, turned
  as the instance was and with its parameter values, inductor couplings
  included; other uses of the child keep calling it. The parent opens with the
  parts selected.

Parts and blocks go where they were when that is clear of other parts, else
beside them. Their connections are made but not drawn: route the wires.

## Cell Pins

The hollow **Cell Pin** is an ordinary interface Pin; the solid **Bias
Voltage Port** marks a bias input (`VB1`, `VB2`). Use a Net Label instead to
name an internal Net only.

1. Press `P`, or place **Cell Pin** / **Bias Voltage Port** from the Library.
2. Click an existing contact to join its Net, or empty grid for a new Net.
3. Double-click its label, or edit **Name** in Properties, to set the formal
   Pin name (naming the Net separately does not rename the Pin).

The generated block symbol is ready at once: inputs on the left, outputs on
the right, other directions balanced. Supply Pins added before any parent
places the Cell start on the block's top (VDD) or bottom (ground) edge; after
that, new Pins no longer move the existing layout. Moving a pin on the block
changes geometry, not netlist port order.

Pins with the same name (case-insensitive) are one Port: the first fixes its
order and spelling, and they are one electrical connection even without a
wire. Different names on one Net stay separate Ports. A Net Label touching a
Cell Pin's Net must use the Pin's name, or it is rejected as a conflict.
Copying a Pin creates a new terminal with the same name and direction.

Renaming a Pin updates parents only if the grouped interface changes;
renaming onto an existing name, or deleting the last connected Pin, asks for
confirmation because parent Nets merge or wires are detached (to editable
Junctions). Undo restores everything. ERC and export report conflicting
directions in one Port and external names that collide with local Cells;
unfinished work can still be saved.

**Cell properties** is one sheet for the Cell's name, its Pins (direction,
block side and netlist order), its parameters and the block's size; **Auto**
returns a pin to its default side. Select a parent instance and open
**Properties** for pin offsets, or **Edit symbol layout on canvas** for drag
grips. Changes apply to every instance. Highlight a Net (`H`) to see its
**Hierarchy Net trace** in Properties, with **Enter** and **Return** across
instance boundaries.

## Cell parameters

Device values can be numbers (`180um`) or expressions (`{2*Rbase}`), kept as
typed. **Cell properties → Parameters** adds a name and default. Edit a name
or default and press `Enter`; renaming updates internal uses and caller
override keys in one undo step. A parameter still in use cannot be deleted.
Cells need defaults for every parameter to export.

Select a parent instance and open **Properties → Instance parameters** to
enter overrides. **Reset** removes the override and inherits the default.
The form shows stored expressions, without pretending to evaluate them.
An override belongs to the instance in its parent definition: if that parent
is reused, every occurrence of the parent shares the override. Editing the
child definition affects all uses; **×N** on its row lists them in the tree.

## External circuits

The hierarchy panel's **External Circuits…** editor holds Project-owned native models.
**New External Circuit** takes a SPICE `.subckt` or Spectre `subckt` body;
its name, terminal order and defaults are parsed beside a pin-labelled
preview. The starter text is commented examples:

```spice
* .subckt my_cell PIN1 PIN2 params: PARAM1=1
```

```spectre
// subckt my_cell (PIN1 PIN2)
// parameters PARAM1=1
```

Uncomment, add the body and end with `.ends my_cell` (or `ends my_cell`).
**Apply model** commits; **Apply & Place** then places it in the parent
(`Esc` keeps the applied model). With several subcircuits, choose the public
entry; helpers stay with the source. The same editor opens from **+** on the
Library's component fold (**Community**, or **My components** on the desktop).

- **Format / Process / Copy** converts this model's draft between SPICE and
  SCS and between processes, as the Netlist sidebar does. Only reviewed core
  SKY130 1.8 V and IHP SG13G2 low-voltage MOS convert; anything else shows an
  inline refusal with **Edit model**. Ideal models show **Abstract**. Copy
  puts the applied definition and helpers on the clipboard.
- **More** holds Save draft, Fork, Files and dependencies (extra files and
  pinned library references), placeholder creation and deletion. **Symbol
  layout and directions** sets pin directions and layout with a live preview.
- **Save draft** keeps unfinished text through closing and saving, without
  changing the applied block. If someone else changes the applied model
  meanwhile, Apply refuses; **Keep my draft on the latest version** rebases
  your text.
- Interface edits update all callers in one undoable step; renaming or
  removing a connected pin asks how to migrate (disconnect keeps the wire as a
  stub). **Fork model…** makes a private copy for independent edits.
- A block without an applied implementation is visibly unimplemented and
  cannot simulate; **Define implementation…** opens its source. Reviewed PDK
  interfaces are read-only: set parameters on instances.

The Netlist sidebar and Copy Netlist include the full applied model bodies
once per source; editing a model body there needs the Apply checkmark or
`Ctrl/Cmd+Enter` and writes back to the same source. A supported Spectre
model runs on ngspice through its derived SPICE; licensed Spectre execution is
not provided. Move models still defined in simulation files into External Circuits
and remove the duplicates there.

## Netlist entry and simulation

In the Netlist panel, **Entry** chooses which Cell to export without changing
Top or your location (**Default Top** follows the saved one). A simulation
experiment keeps its own **Simulation Cell**, unaffected by Top changes.
