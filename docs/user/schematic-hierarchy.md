# Schematic hierarchy

Analog Canvas treats every Project Document as one reusable schematic Cell.
The top Cell is the export root; other Cells may be instantiated any number of
times or kept unreferenced while they are being authored.

Use **Manage Cells…** in the hierarchy row to manage the Project's definitions in one place. It shows each
Cell's formal Pin and caller counts, opens or renames a definition, and lists
each caller with **Jump to caller**. A referenced Cell's delete control is
disabled; delete its caller Instances normally before deleting the now
unreferenced definition.

Use **New Cell** in the Cell Manager to create a module without first drawing
a rectangle. **Cell → Place Cell** opens the normal Insert dialog with a
searchable **Cells** section. Select a definition, then place its ordinary
hierarchical Instance on the canvas using the same grid preview, `R` rotation,
mirror shortcuts, and `Esc` cancellation as a library component. The commit
keeps the `Xn` reference as internal netlist identity and shows only the Cell
name at the normal instance-label position. **Enter Cell** opens the child of a selected hierarchical
Instance. **Up** follows the actual parent Instance path; **Top** returns to
the root. Opening a shared Cell from the selector has no caller context when
more than one path reaches it, which is reported in the status bar.

The top Cell is the Project export root and is not instantiated as a symbol,
but it is still emitted as a reusable structural subcircuit. **Port** and
**Filled Port** are hollow and filled artwork for the same **Cell Pin** concept.
A Cell Pin defines one independently authored interface declaration. Use Net
Label instead when you only need to name an internal Net.

To define a real Cell port:

1. Press `P`, or place **Port** / **Filled Port** from the Library.
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
independent stable identity, name, direction, and internal Base Net. An
in-place copy retains the same visible name; later edits to either Pin do not
affect the other. As with every copied connected component, a Pin
whose Net crosses the selection boundary remains attached to that existing
Net, but its declaration identity is still independent. Placing or renaming a
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

Rectangles remain drafting geometry. Selecting an unlocked rectangle and using
**Enter Cell** is only a convenience gesture: the commit removes the rectangle,
creates a child Cell, and places an ordinary hierarchical Instance. Saved
hierarchy never depends on rectangle drawing data.

Select a Cell Instance in a parent and open **Properties** to adjust that
Cell's shared symbol layout: body width/height and each pin side/offset. Pin
names follow their pin automatically and never take over the external wiring
anchor. Use **Auto** to return a pin to direction-aware placement. **Edit
symbol layout on canvas** reveals explicit drag grips for the body and pins;
the Properties values remain the precise fallback. These are definition operations,
not top-level drawing tools.

Hierarchy presentation is saved as definition-level size and pin-placement
intent in current Project schema 25. Schema-24 projects open through the
bounded upgrade; schema-23 and older files remain unsupported. The block uses
a closed polygon body and the shared Razavi rich-text renderer for pin and Cell
names; it is compatible with that visual grammar rather than a pixel-for-pixel
textbook symbol asset.
