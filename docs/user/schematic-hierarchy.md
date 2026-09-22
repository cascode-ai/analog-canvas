# Schematic hierarchy

Analog Canvas treats every Project Document as one reusable schematic Cell.
The top Cell is the saved default entry; other Cells may be instantiated any number of
times or kept unreferenced while they are being authored.

In **Manage Cells…**, select a Cell and choose **Set as Top**, or drag it onto the first, **Top** row to change
the saved default entry. The drop preview says **Set as Top**. Dragging among
other rows only changes the saved list order; dropping at the bottom moves a Cell
to the end. Both order and Top changes are undone together. This does not change the circuit, its callers, the
current editing location, or an explicitly selected simulation entry. Undo and
Redo restore this setting. Opening a definition from Manager clears caller
context; enter through an instance when you need its specific parent path.
The Manager's **Hierarchy** tree opens concrete instance occurrences. Expand
only the branches you need; repeated calls to one Cell retain separate paths.
The Cell list stays stable regardless of reachability. Double-click a row to open
its definition; edit the detail heading to rename it (Enter or blur commits,
Escape cancels). **Delete** is beside the selected Cell's heading. Alt+Up/Down also reorder a focused row;
Alt+Up into the first row makes that Cell Top.

Use **Manage Cells…** in **Edit** or the hierarchy row to manage the Project's definitions in one place. It shows each
Cell's projected Port and caller counts, opens or renames a definition, and lists
each caller with **Jump to caller**. Equal Port names occupy one row, matching
the generated Symbol; a marker count preserves visibility into repeated canvas
declarations. A referenced Cell's delete control is
disabled; delete its caller Instances normally before deleting the now
unreferenced definition.

The Manager separates **Cells** (local schematics) from **External Circuit Defs**
(project-level declarations for external models). Local Cell interfaces come
from their canvas Pins; external declarations specify the model target,
ordered terminals, and formal parameters. Use **New External Circuit Def** in
the external list to add a declaration, or select an existing one to edit it.
External definitions have no local schematic to open or reset. Editing their
declaration does not import or modify the external model implementation.
Enter a target name and its ordered terminals (commas or spaces), then use
**Create External Circuit**. Select a saved declaration and choose **Place**
to start ordinary canvas placement; **Save definition** updates its interface.
Renaming a generic external target keeps its definition identity and updates
its callers; it does not rename a model inside source files. **Delete definition**
uses an internal confirmation and is available only when no instances reference
the definition. Deletion supports Undo/Redo. The shared **Callers** list locates
external instances just as it does local ones.
Validation errors appear inside the Manager. Its pins connect to Nets and
export as an external subcircuit call, but simulation still requires the actual
model implementation in the simulation source files.
Generic External blocks share the Cell symbol layout controls in Properties:
body size, pin side/offset, and canvas drag handles. A layout edit updates every
instance and follows connected routes in the same undoable transaction. Native
PDK device symbols retain their reviewed artwork instead of exposing generic
block resize handles.
An exact reviewed PDK interface is read-only in Manager: its target, ordered
terminals and parameter declarations belong to the reviewed mapping. Set device
parameter values on instances instead. Neither a generic declaration nor a
reviewed mapping alone proves that a particular simulation has its model sources.
Local Cell symbols inherit the representative Port annotation's explicit
RichText formatting. The current drawing's label settings can apply underscore,
first-letter, case and slant conventions to visible pins as well as labels;
see [label names and typography](getting-started.md#label-names-and-typography).
Rendering pin names never changes a component's electrical pin identity or
external model interface. Complement output bars are retained.

Use **New Cell** in the Cell Manager to create a module. **Place Cell** in the
hierarchy row, or **Edit → Place Cell from this Project…**, opens the Insert
dialog as a searchable, Cells-only **Place Hierarchical Cell** picker. Select a
definition, then place its ordinary hierarchical Instance on the canvas using
the same grid preview, `R` rotation, mirror shortcuts, and `Esc` cancellation
as a library component. The commit keeps the `Xn` reference as internal
netlist identity and shows only the Cell name at the normal instance-label
position. **Enter Cell** opens the child of a selected hierarchical Instance.
**Shift+E** follows the actual parent Instance path; **Top** returns to the root.
Opening a Cell from the selector or Manager's definition list always opens the
definition without caller context, even when it has only one caller. **Shift+E** is
disabled in that context. Enter an instance or use the hierarchy tree to carry
a concrete path; **Shift+E** then returns to and selects the original caller.

In the Netlist panel, **Entry** chooses a Cell for this export only. **Default
Top** follows the saved default; another selection drives the preview, structural
check and copied netlist without changing Top or your editing location. Code
edits apply to the displayed Cell's actual devices. Entry selection is disabled
while a text draft is pending, and resets for a different opened Project.
New simulation folders have their own **Simulation Cell** choice. The experiment
keeps that circuit binding when the Project's default Top changes; simulation
source files and analysis settings remain owned by the experiment.

Use **Import Cell** in the Cell Manager to copy a Cell from another signed-in
Cloud Project. The import includes every child Cell it calls, compatible
external-subcircuit interfaces, formal ports, presentation, and referenced
source metadata. It is one ordinary undoable Project transaction: the source
Project is never modified, and the destination copy does not follow later
source changes. Identity and colliding Cell names are remapped
deterministically; importing the same source Cell again opens the existing
copy rather than creating another hidden duplicate. The first release requires
the source and destination to use the same exact Symbol Library lock and
reports incompatible external interfaces without changing either Project.

The default top Cell is still a reusable structural subcircuit; it can be placed
in another Cell when this does not create a recursive hierarchy. The hollow
**Cell Pin** is the ordinary interface Pin. The solid **Bias Voltage Port** is
the marker for a bias-voltage entry, typically named `VB1`, `VB2`, and so on.
Both define independently authored interface declarations. Use Net Label
instead when you only need to name an internal Net.

To define a real Cell port:

1. Press `P`, or place **Cell Pin** / **Bias Voltage Port** from the Library.
2. Click an exact existing electrical contact to attach to its Net, or click
   empty grid space to create a new local Net.
3. Double-click its default annotation to edit the interface name; use normal
   **Properties** only for direction.

Formal-Pin placement commits the ordinary `port`/`port-filled` Instance, its
pin-`P` connection, and the stable formal Cell terminal as one revision. Inputs
are placed on the left of generated parent symbols, outputs on the right, and
other directions are balanced automatically. The symbol body and pin placement
adapt without a separate interface editor.

Each visible marker remains an ordinary Instance for selection, move, wiring,
copy, and deletion. Copying a Cell Pin creates a new formal terminal with an
independent stable identity and a freshly allocated interface name, with its
direction preserved. Copy follows ordinary insertion: destination contacts
determine connectivity; off-selection source connectivity is not inherited.
Only explicitly selected wires travel with the copy. Markers keep independent
canvas identities, but names have electrical meaning: equal case-insensitive
Port names belong to one Logical Net. Sharing a name need not merge their
underlying Base Net objects or draw a wire between the markers.

When the Cell is used as a hierarchical block or exported, a read-only final
projection groups case-insensitively equal Pin names into one Formal Port. The
first Pin fixes that Port's order and spelling. Grouping does not rewrite the
canvas objects, but the logical connection is real, including during export.
Different Port names on the same internal Net remain separate interface pins.
Moving a symbol pin to another side changes geometry, not the netlist port order.

Renaming that annotation changes only the selected Pin. Parent Instances are
updated only if the before/after grouped interface actually changes. Deleting
one of several same-name Pins leaves the parent Formal Port intact. Its layout
follows the surviving representative, and its same-spelling RichText format is
inherited unless the survivor already has an explicit format. Deleting
the last removes it and detaches affected caller wire endpoints to editable
Junctions in the same undoable Project transaction.
Deleting the last connected Port requires internal confirmation; it does not
require deleting all other Ports first. Renaming to an existing interface name
also requires confirmation: this can merge the corresponding parent Nets.
Cancel leaves the Project unchanged; Undo restores the complete operation.
Incompatible power-domain connections remain rejected.

ERC and formal netlist export diagnose conflicting directions within one
effective Port, and external master names that collide with local exported Cell
names. These findings do not prohibit saving unfinished work. Authoring previews
retain missing positional nodes as explicit placeholders; they are not runnable
netlists and must not be treated as successful simulation preparation.
**Delete Cell** removes only a non-top, unreferenced Cell definition and can be undone or redone.
Deleting a hierarchical Instance with the normal Delete command never deletes
its reusable child Cell.

Rectangles are drafting geometry only. Create reusable Cells through
**Manage Cells…** and place them with **Place Cell**; **Enter Cell** never
converts drawing objects.

Select a Cell Instance in a parent and open **Properties** to adjust that
Cell's shared symbol layout: body width/height and each pin side/offset. Pin
names follow their pin automatically and never take over the external wiring
anchor. Use **Auto** to return a pin to direction-aware placement. **Edit
symbol layout on canvas** reveals explicit drag grips for the body and pins;
the Properties values remain the precise fallback. These are definition operations,
not top-level drawing tools.

Highlight a connected Net with **H** or **Highlight Net** to inspect
**Hierarchy Net trace** in Properties. Its **Enter** and **Return** actions
follow the selected electrical connection across a concrete instance boundary
and highlight the destination Net. Direct definition navigation does not invent
an occurrence path.

The generated Symbol is ready for the first placement without a separate review
or apply step. Customize it from a placed parent Instance when needed. An
unreferenced top Cell is reusable too: create another ordinary Cell, then use
**Place Cell** to place the original top there. The Project top does not change.
A valid zero-port interface is allowed; an absent formal interface must be
authored first.

Cell Manager does not expose destructive drawing/placement/body reset actions.
Their typed editing operations remain available to explicit programmatic workflows.

## Cell parameters

Edit electrical values directly in a device's Property JSON. Numeric text such
as `180um` or `80nm` and expressions such as `{Rbase}` or `{2*Rbase}` remain
exactly as authored, without per-value buttons or redundant unit comments.
For a new Cell parameter, declare its name and default in the Cell's Project
Code first, then reference it in the device value. For example, declare
`Rbase=1k` and set a resistor's value to `{Rbase}`. Existing declarations remain
available to all devices in that Cell. Point lists and derived digital-clock
controls are not scalar parameter slots.

Manager lists declared parameter names and defaults. Hover a name to see internal
reference and caller override counts; these counts are not another setting. Edit a name
or default and press Enter or leave the field to commit. Renaming updates
internal references and every caller's override key atomically, but does not
rewrite expressions belonging to a parent Cell's own scope. Unused declarations
remain until explicitly removed; references or caller overrides must be removed
before deleting a declaration. Invalid or unsupported expressions are not
silently rewritten.

Select a parent Cell instance to enter overrides in its Property JSON.
An empty value inherits the definition default; clearing an override restores
inheritance. Changing a default affects inheriting instances, not explicit
overrides. Manager hides the parameter table only when there are no declarations:
an imported parameter without a default still appears and can be repaired.
New local parameters require defaults, and internal Cells without defaults
cannot be exported as executable netlists.

Agents use the existing `create-cell` action and `place-cell` with
`childDocumentId`, `instanceId`, optional `reference`, and `placement`, targeting
the parent Document. The same Project transaction owns validation and history;
these actions do not create or modify a simulation folder.

The import planner and its small Project edits are also public API contracts.
An Agent that already holds an authorized source Project can plan the same
independent closure and submit it through the standard structural transaction;
the transaction remains revision-guarded and atomic. Reading a private Cloud
Project is a separate account-authorized operation and is never implied by
simulation permission: the Agent Project resource (`list-projects`,
`list-cells`, `import-cell`) requires the `project.import` scope.

Hierarchy presentation is saved as definition-level size and pin-placement
intent in current Project schema 57. Schema-24 through schema-56 projects open
through the chained upgrade; schema-23 and older files remain unsupported. The
block uses a closed polygon body and the shared Razavi rich-text renderer for
pin and Cell names; it is compatible with that visual grammar rather than a
pixel-for-pixel textbook symbol asset.
