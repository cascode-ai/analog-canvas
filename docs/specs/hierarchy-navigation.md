# Hierarchy navigation

Status: `accepted`

Primary owner: `apps/editor`

The editor projects the Project's Cell calls as one navigation tree.
[Schematic hierarchy](../user/schematic-hierarchy.md) describes its controls;
[schematic model](schematic-model.md) owns the stored circuit.

## Rules

- Top is the first root. Definitions unreachable from Top appear under their
  disconnected roots, with their nested calls. There is no second definition list.
- Each occurrence uses a root Document ID and ordered Instance IDs. Repeated
  definitions have distinct paths; names are display text, never identity.
- Definition opening has an empty path. Up follows the actual caller and
  selects its instance. Tree, breadcrumb, enter and return fit like F.
- Navigation and expansion belong to the tab workspace, survive refresh and
  create no circuit history entry. A deleted or rebound path returns to its
  nearest surviving ancestor; Agent edits follow the same rule.
- Definition changes affect every use. Instance overrides belong to the parent
  definition and therefore every occurrence of that parent. Forms identify
  that scope and support inheritance by removing the override.
- A new child stays transient until its placement. Definition, optional Pins
  and caller commit atomically; cancelling leaves no orphan. Reuse, interface
  migrations and deletion retain the Edit Engine's validation and confirmations.
- Default Top, explicit export entry and each simulation's root are independent.
- The usage list shows at most 50 occurrences and reports truncation; counts
  saturate at 1,000,000. Tree expansion remains lazy and can reach other uses.

## Acceptance criteria

- [Browser workflows](../../apps/editor/e2e/unified-hierarchy.spec.ts) exercise
  four levels, repeated parents, disconnected Cells, restored paths, scoped
  overrides, draft cancellation and atomic creation/undo.
- [Creation transactions](../../apps/editor/src/features/hierarchy/new-child-cell.test.ts)
  and [parameter authoring](../../packages/edit-engine/src/cell-parameter-planner.test.ts)
  validate the circuit changes independently of the UI.
- [Portable hierarchy](../../packages/netlist/src/hierarchy-navigation.test.ts)
  retains repeated parameters through serialization, both netlist dialects
  and bidirectional net tracing across four levels.
