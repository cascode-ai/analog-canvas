# Schematic hierarchy

Every Project Document is a reusable schematic Cell. The top Cell is the
saved default entry; other Cells can be placed any number of times or left
unreferenced while you work on them. The top Cell can itself be placed in
another Cell, as long as no recursion results.

## Hierarchy tree

Open **Hierarchy** in the toolbar or **Circuit → Hierarchy → Hierarchy tree…**.
The single tree starts at **Top** and expands actual instance occurrences to
any supported depth. **Not connected to Top** contains unused root definitions
and their children. Each row shows the instance reference and its Cell name.

- Click a row, double-click a canvas instance, or press **E** to enter it.
  The breadcrumb records the exact instance path. **Up** / **Shift+E** returns
  to its caller and selects that instance; **Top** opens the saved default.
  Navigation fits the drawing as **F** does and does not edit the circuit.
- The row's **…** menu opens the shared definition, **Cell properties**,
  **Show uses**, or placement in the current Cell. Opening a definition has
  no parent path; choose a concrete use to resume occurrence navigation.
- **New child** accepts a name and optional Ports, then previews the block in
  the current Cell. Clicking creates the definition, interface and caller in
  one undo step and enters the child. **Esc** before placement leaves no Cell.
- **Place Cell** reuses an existing definition with normal placement controls
  (`R`, mirror, `Esc`). Self-instantiation and cycles are refused with a reason.
- **Cell properties** edits the definition name, interface, parameters and
  symbol layout. **New definition** creates an unattached Cell. **Delete**
  removes only an unreferenced, non-top definition; deleting an instance never
  deletes its Cell. **Move earlier** changes definition order, not Top.
- **Set as Top** changes the saved default entry. It is undoable and does not
  change the editing path, explicit netlist Entry or a simulation's Cell.
- **Import Cell** copies a Cell from another Cloud Project with its children,
  compatible external models and presentation in one undo step. The copy is
  independent; repeating the import opens it. Symbol Library versions must match.

Tree expansion and instance paths are remembered per Project tab and after a
refresh. If an edit removes part of the current path, navigation returns to
the nearest surviving parent. Renaming a Cell does not change the path.

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

Open **Cell properties**, or select a parent instance and open **Properties**, to set the block's
size and each pin's side and offset (**Auto** returns a pin to its default),
or **Edit symbol layout on canvas** for drag grips. Changes apply to every
instance. Highlight a Net (`H`) to see its **Hierarchy Net trace** in
Properties, with **Enter** and **Return** across instance boundaries.

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
child definition affects all uses; **Show uses** locates them in the tree.

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
entry; helpers stay with the source. The same editor opens from **Edit → User
Components… → Create Component…**.

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
not provided. Move models still defined in simulation files into the Manager
and remove the duplicates there.

## Netlist entry and simulation

In the Netlist panel, **Entry** chooses which Cell to export without changing
Top or your location (**Default Top** follows the saved one). A simulation
experiment keeps its own **Simulation Cell**, unaffected by Top changes.
