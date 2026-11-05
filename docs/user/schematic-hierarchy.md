# Schematic hierarchy

Every Project Document is a reusable schematic Cell. The top Cell is the
saved default entry; other Cells can be placed any number of times or left
unreferenced while you work on them. The top Cell can itself be placed in
another Cell, as long as no recursion results.

## Cell Manager

Open **Cell Manager…** (**Circuit → Hierarchy**, or **Manage Cells…** in the
hierarchy toolbar). It lists each Cell with its Port and caller counts, opens
or renames it, and lists callers with **Jump to caller**.

- **Set as Top**, or drag a Cell onto the **Top** row, changes the default
  entry; dragging among other rows only reorders the list (`Alt+Up/Down` with
  a row focused). Neither changes the circuit, the editing location or a
  simulation's chosen Cell, and both are undoable.
- Double-click a row to open the definition; edit its heading to rename it.
  Opening from the Manager has no caller context; enter through an instance
  (or the **Hierarchy** tree of concrete occurrences) to keep the parent path.
- **New Cell** creates a module. **Delete** removes only an unreferenced,
  non-top Cell (undoable); delete its callers first. Deleting an instance
  never deletes its Cell.
- **Import Cell** copies a Cell from another of your Cloud Projects with its
  child Cells, compatible external models, ports and presentation, as one
  undoable step. The copy is independent of the source; importing the same
  Cell again opens the existing copy. Both Projects must use the same Symbol
  Library version.

**Place Cell** in the hierarchy toolbar (or **Edit → Place Cell from this
Project…**) opens a searchable Cell picker; place the instance like any
component (`R`, mirror, `Esc`). It shows the Cell name; its `Xn` instance name
is the netlist identity. **Enter Cell** (`E`) opens a selected instance's
child, **Shift+E** returns to the caller along the actual path, **Top** jumps
to the root. Self-instantiation and cycles are refused with a reason.
Entering or leaving a Cell this way lands fitted, as **F** does; a Cell opened
from the **Cells** selector or Manager's definition list keeps its last view.

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

Select a Cell instance in a parent and open **Properties** to set the block's
size and each pin's side and offset (**Auto** returns a pin to its default),
or **Edit symbol layout on canvas** for drag grips. Changes apply to every
instance. Highlight a Net (`H`) to see its **Hierarchy Net trace** in
Properties, with **Enter** and **Return** across instance boundaries.

## Cell parameters

Device values can be numbers (`180um`) or expressions (`{2*Rbase}`), kept as
typed. To add a Cell parameter, declare it with a default in the Cell's
Project Code (`Rbase=1k`), then use it in device values. The Manager lists
declared parameters: edit a name or default and press `Enter`. Renaming
updates internal uses and every caller's override key in one step; a
parameter still in use cannot be deleted. On a parent instance, enter
overrides in its Property JSON; an empty value inherits the default. Cells
need defaults for every parameter to export.

## External circuits

The Manager's **External Circuits** list holds Project-owned native models.
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
