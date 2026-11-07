# Hierarchy navigation

Status: `accepted`

Primary owner: `apps/editor`

The editor projects the Project's Cell calls as one navigation tree.
[Schematic hierarchy](../user/schematic-hierarchy.md) describes its controls;
[schematic model](schematic-model.md) owns the stored circuit.

## Rules

- Hierarchy keeps no resident row or column: the tree opens on demand, and the
  instance path floats over the canvas only away from a root (inside a child
  occurrence, or in a directly opened definition something calls).
- The tree is the one place for Cell commands: creating, placing, Cell
  properties, Set as Top, the refactors and Import Cell. External circuits are
  rows of the same panel, below the Cells and only while the Project has any:
  each opens, places (icon or drag), lists its callers and deletes once unused
  as a Cell row does; the footer starts a new one. Opening a model shows that
  one model's sheet; the panel, not the sheet, lists them.
  Circuit › Hierarchy only shows or hides it; the canvas menu keeps Enter
  Cell, and Edit keeps
  [Place Cell](editor-interaction.md#components-and-interface-markers). A child
  Cell made from canvas parts starts from a row of the open Cell.
- Every row command is in the row's menu, which stays inside the window and
  opens from the keyboard too (Menu key or Shift+F10; arrow keys move in it).
- Only icon buttons explain themselves on hover. Names, badges and counts
  carry no hover text, and a refused tree command says why in its menu.
- The tree, its uses and its matches are exactly as wide as the panel: a row or
  match too long for it truncates its name, a use wraps, and none widens the
  others.
- Every Cell that no Cell calls is a root, with its nested calls. Roots keep
  the order they were first listed in for the session, Top first; later roots
  append. Top is a mark on its Cell, so changing Top moves no row. There is no
  second definition list.
- Each occurrence uses a root Document ID and ordered Instance IDs. Repeated
  definitions have distinct paths; names are display text, never identity.
- Definition opening has an empty path. Up follows the actual caller and
  selects its instance. Tree, path, enter and return fit like F.
- Navigation and expansion belong to the tab workspace, survive refresh and
  create no circuit history entry. A deleted or rebound path returns to its
  nearest surviving ancestor; Agent edits follow the same rule.
- Definition changes affect every use. Instance overrides belong to the parent
  definition and therefore every occurrence of that parent. Forms identify
  that scope and support inheritance by removing the override.
- A new child stays transient until its placement. Definition, optional Pins
  and caller commit atomically; cancelling leaves no orphan. Reuse, interface
  migrations and deletion retain the Edit Engine's validation and confirmations.
  Deleting a Cell a simulation runs asks first; the experiment keeps naming
  it for repair.
- The editor names Cells, new or renamed, with letters, digits and `_`; no
  edit may give a Cell and an external circuit one name.
- Make unique copy, Replace Cell, New child Cell from selection and Flatten
  are each one Project transaction. One that edits a Cell with several uses says
  so in text with the command before it runs, and in its result.
- Make unique copy names the copy after the source's next free number.
- Make unique copy and Replace rebind as a Cell rename does: a Library part
  bound to the Cell keeps its own symbol, and a shown Cell name follows.
- Replace accepts only Cells with the same Pin names, ignoring case, that form
  no cycle; the plan refuses any other. It drops overrides of parameters the
  new Cell does not declare, and its list names them before it runs.
- New child Cell from selection makes one Pin per Net leaving the parts,
  passes the parent parameters they use, and refuses to split an inductor
  coupling.
- Flatten substitutes the instance's parameter values, brings the child's
  inductor couplings and keeps other uses of the child. Child Nets joined by
  a name stay one Net; a global name keeps its spelling, and an inner Net's
  local or imported name is prefixed with the reference on a clash.
- Moved parts and blocks are connected, not routed, and never placed over
  other parts.
- Default Top, explicit export entry and each simulation's root are independent.
- The usage list shows at most 50 occurrences and the filter at most 100
  matches, each reporting truncation; counts saturate at 1,000,000. Tree expansion remains lazy and can reach other uses.

## Acceptance criteria

- [Browser workflows](../../apps/editor/e2e/unified-hierarchy.spec.ts) exercise
  four levels, repeated parents, disconnected Cells, restored paths, scoped
  overrides, draft cancellation, atomic creation/undo, moving Top, the four
  refactors with one Undo each and deep rows staying inside the panel.
- [The menus](../../apps/editor/src/app/App.test.tsx) leave Circuit › Hierarchy
  only the tree toggle, and
  [the tree](../../apps/editor/src/features/hierarchy/cell-hierarchy-tree.test.tsx)
  keeps hover text on its icons.
- [Creation transactions](../../apps/editor/src/features/hierarchy/new-cell.test.ts),
  [refactor plans](../../apps/editor/src/features/hierarchy/hierarchy-refactor.test.ts)
  and [parameter authoring](../../packages/edit-engine/src/cell-parameter-planner.test.ts)
  validate the circuit changes independently of the UI;
  [root order](../../apps/editor/src/features/hierarchy/project-hierarchy.test.ts)
  covers Top switches and new roots, and the
  [read model](../../packages/derived/src/project-hierarchy.test.ts) roots only
  Cells nothing calls.
- [Portable hierarchy](../../packages/netlist/src/hierarchy-navigation.test.ts)
  retains repeated parameters through serialization, both netlist dialects
  and bidirectional net tracing across four levels.
