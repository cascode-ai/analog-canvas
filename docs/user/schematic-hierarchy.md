# Schematic hierarchy

Analog Canvas treats every Project Document as one reusable schematic Cell.
The top Cell is the export root; other Cells may be instantiated any number of
times or kept unreferenced while they are being authored.

Use **Manage Cells…** in **Edit** or the hierarchy row to manage the Project's definitions in one place. It shows each
Cell's projected Port and caller counts, opens or renames a definition, and lists
each caller with **Jump to caller**. Equal Port names occupy one row, matching
the generated Symbol; a marker count preserves visibility into repeated canvas
declarations. A referenced Cell's delete control is
disabled; delete its caller Instances normally before deleting the now
unreferenced definition.

The Manager separates **Cells** (local schematics) from **External Circuits**
(project-level declarations for external models). Local Cell interfaces come
from their canvas Pins; external declarations specify the model target,
ordered terminals, and formal parameters. Use **New External Circuit** in
the external list to add a declaration, or select an existing one to edit it.
External definitions have no local schematic to open or reset. Editing their
declaration does not import or modify the external model implementation.
Enter a target name and its ordered terminals (commas or spaces), then use
**Create External Circuit**. Select a saved declaration and choose **Place**
to start ordinary canvas placement; **Save definition** updates its interface.
Validation errors appear inside the Manager. Its pins connect to Nets and
export as an external subcircuit call, but simulation still requires the actual
model implementation in the simulation source files.
Generic External blocks share the Cell symbol layout controls in Properties:
body size, pin side/offset, and canvas drag handles. A layout edit updates every
instance and follows connected routes in the same undoable transaction. Native
PDK device symbols retain their reviewed artwork instead of exposing generic
block resize handles.
Port names do not infer subscripts from spelling. Local Cell symbols inherit
the representative Port annotation's explicit RichText formatting, including
subscripts; generic External pin names remain whole by default. This does not
change electrical names or the typography of device references such as M1.

Use **New Cell** in the Cell Manager to create a module. **Place Cell** in the
hierarchy row, or **Edit → Place Cell from this Project…**, opens the Insert
dialog as a searchable, Cells-only **Place Hierarchical Cell** picker. Select a
definition, then place its ordinary hierarchical Instance on the canvas using
the same grid preview, `R` rotation, mirror shortcuts, and `Esc` cancellation
as a library component. The commit keeps the `Xn` reference as internal
netlist identity and shows only the Cell name at the normal instance-label
position. **Enter Cell** opens the child of a selected hierarchical Instance.
**Up** follows the actual parent Instance path; **Top** returns to the root.
Opening a shared Cell from the selector has no caller context when more than
one path reaches it, which is reported in the status bar.

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

The top Cell is the Project export root and is not instantiated as a symbol,
but it is still emitted as a reusable structural subcircuit. **Port** and
**Filled Port** are hollow and filled artwork for the same **Cell Pin** concept.
A Cell Pin defines one independently authored interface declaration. Use Net
Label instead when you only need to name an internal Net.

To define a real Cell port:

1. Press `P`, or place **Cell Pin** / **Cell Pin (filled)** from the Library.
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
Only explicitly selected wires travel with the copy. Later edits to either
Pin do not affect the other. Placing or renaming a
Pin to the same name never attaches it to another Pin or merges their Nets.

When the Cell is used as a hierarchical block or exported, a read-only final
projection groups case-insensitively equal Pin names into one Formal Port. The
first Pin fixes that Port's order and spelling. Grouping does not modify the
canvas objects; only a Wire or explicit electrical contact connects them while
drawing.

Renaming that annotation changes only the selected Pin. Parent Instances are
updated only if the before/after grouped interface actually changes. Deleting
one of several same-name Pins leaves the parent Formal Port intact; deleting
the last removes it and detaches affected caller wire endpoints to editable
Junctions in the same undoable Project transaction.
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

The generated Symbol is ready for the first placement without a separate review
or apply step. Customize it from a placed parent Instance when needed. An
unreferenced top Cell is reusable too: create another ordinary Cell, then use
**Place Cell** to place the original top there. The Project top does not change.
A valid zero-port interface is allowed; an absent formal interface must be
authored first.

Cell Manager contains a collapsed **Reset Cell** section for the selected
definition. Clear Drawing, Reset Cell Placement, and Reset Cell Body retain
their distinct scopes, show an exact impact preview, and remain undoable.

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
