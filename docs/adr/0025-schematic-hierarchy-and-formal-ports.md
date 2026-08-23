# 0025 - Schematic hierarchy and formal Cell ports

Status: `accepted`

Date: `2026-08-18`

Owners: `packages/model`, `packages/project-protocol`,
`packages/edit-engine`, `packages/symbols`, `packages/derived`,
`packages/netlist`, `packages/agent-adapter`, `apps/editor`

## Context

Project schema 11 can persist imported subcircuit relationships through a
parent Instance binding to a child Document, and it privately maps ordered
formal terminal names to child Nets through `Document.netlist.terminals`.
Manual hierarchy authoring later reused that shape to replace a drafting
rectangle with a zero-terminal subcircuit Instance and an empty child
Document.

Those pieces do not form a complete schematic hierarchy contract. A formal
terminal has no stable identity, direction, or corresponding editable object
inside the child schematic. Port artwork placed from the palette is an
ordinary Instance and does not define the Cell interface. Project validation
does not reject a missing child target or a hierarchy cycle. Structural
creation rebuilds per-Document history, so it is not undoable, and removing a
hierarchy Instance leaves no supported way to manage its reusable child Cell.

The product already has the required lower-level authorities: a Document is a
complete schematic Cell definition, subcircuit bindings identify reusable
child Documents, ordinary `port` / `port-filled` Instances already participate
in the common Symbol, Net, Route, selection, rendering, clipboard, and delete
paths, and the derived Project index and netlist exporter already traverse
hierarchy. Introducing generic Cell/View/Layout containers or another drawing
and mutation protocol would duplicate those authorities and exceed the current
schematic-only product boundary.

## Decision

All readers return the sole schema-12 in-memory Project shape.

### Schema 12 is schematic-only

Advance the Project format to schema 12. Keep `CircuitProject.documents` and
`topDocumentId`; each Document remains one reusable schematic Cell definition.
Do not add generic view, layout, page, library, or simulation-deck containers.

Add a persisted Project `structureRevision` used only by atomic structural
transactions. Ordinary one-Document edits retain their existing Document
revision behavior.

### Formal ports reuse ordinary Port Instances

Extend each ordered `Document.netlist.terminals` entry with:

- a stable terminal ID independent of its editable name;
- `input`, `output`, `inout`, or `passive` direction;
- the ID of one ordinary `port` or `port-filled` Instance in the same
  Document.

The referenced Instance is the visible child-schematic port. Its ordinary pin
`P` must belong to the terminal's declared Net. It continues to use the common
Instance, terminal, Route endpoint, resolver, renderer, selection, clipboard,
and deletion protocols. A Port Instance not referenced by the Cell interface
remains an ordinary interface marker and gains no implicit hierarchy meaning.

The formal terminal ID is the authoring and UI identity. Existing parent Net
and Route terminal references continue to use the hierarchical Symbol pin
name. A terminal rename is therefore a Project structural operation that
atomically rewrites every caller's matching pin references. This bounded
reconciliation avoids a project-wide terminal-reference redesign while
making rename safe.

Cell-interface Port Instances are interface declarations, not emitted device
instances. Design-netlist extraction omits those marker Instances and emits
the ordered formal interface exactly once from `Document.netlist.terminals`.

### Hierarchy remains an Instance graph

A hierarchy edge remains:

```text
parent Document
  -> ordinary Instance with subcircuit binding
  -> child Document
```

The child Document is a reusable definition and may have multiple caller
Instances. Project validation requires every child target to exist, requires
the binding name to match the child Cell name under case folding, and rejects
cycles. Unreferenced non-top Documents are valid project-local reusable Cells.

Deleting an Instance never implicitly deletes its child definition. Deleting
a Cell definition is a separate structural operation: the top Cell cannot be
deleted, and a referenced Cell cannot be deleted until its caller Instances
are removed. There is no implicit recursive garbage collection.

### Structural edits reuse the Edit Engine

Add one Project transaction wrapper owned by `@icm/edit-engine`. It composes
the existing `SchematicEdit` transactions with the minimal Project structure
edits needed to add/remove Documents and reconcile formal interfaces. It
validates exact `structureRevision` and affected Document revisions, applies
all edits to a clone, validates the complete Project, and commits all or none.

GUI and Agent hierarchy mutations use this wrapper; direct Project replacement
remains a file/open/recovery boundary and is not an authoring operation. One
successful structural transaction advances `structureRevision` once and each
changed Document revision once. The editor records the complete Project
transition as one undo item.

Reusable hierarchy orchestration follows the same package boundary. Pure
helpers in `@icm/edit-engine` construct canonical hierarchy Instances and plan
Cell creation, placement, rename/delete, formal-Port lifecycle, and terminal
presentation edits. Read-only Cell/caller summaries belong to `@icm/derived`.
The Editor collects user intent and canvas-dependent geometry, submits the
planned edits, and presents results; it does not assemble Project structure
edits or maintain a parallel hierarchy model.

### Formal blocks use the Instance/Symbol path

The Rectangle drawing tool remains drafting-only. A hierarchy creation gesture
may use rectangle geometry as transient input, but the committed result is a
subcircuit Instance rendered and selected through the existing hierarchical
Symbol path. No persisted DraftRectangle is an intermediate hierarchy state.

Hierarchy navigation carries concrete Instance frames. A child definition
opened without a caller path has no guessed parent; callers are selected
explicitly when upward navigation is ambiguous.

### Compatibility stays rolling and direct

Replace the schema-10-to-11 adapter with one direct schema-11-to-12 adapter.
It deterministically:

- adds `structureRevision: 0`;
- assigns each existing formal terminal a stable ID and `passive` direction;
- creates one unplaced ordinary `port` Instance for each formal terminal;
- connects that Instance's pin `P` to the terminal's existing child Net; and
- records the new interface Instance ID on the terminal.

It does not reinterpret existing canvas Port Instances or drafting rectangles.
Ambiguous or invalid hierarchy is rejected after transformation by the current
schema rather than repaired. Schema 10 becomes unsupported when schema 12 is
current, preserving the rolling N-1 policy.

## Alternatives considered

### Add generic Cell and View containers

- Benefits: resembles IC platforms that can hold schematic, symbol, layout,
  behavioral, and extracted views.
- Costs: duplicates the existing Document Cell authority and introduces
  layout/multi-view concerns outside this product's schematic scope.
- Reason not selected: the requested hierarchy can be expressed by completing
  the current Document/Instance contract.

### Add a separate first-class canvas Port collection

- Benefits: a dedicated object can carry interface semantics directly.
- Costs: duplicates Instance rendering, selection, placement, terminal, Route,
  clipboard, delete, Snapshot, and Agent edit protocols that ordinary Port
  symbols already implement.
- Reason not selected: an explicit formal-interface reference can specialize
  an existing Port Instance without creating a second canvas protocol.

### Keep name-only formal terminals

- Benefits: no persisted terminal ID.
- Costs: rename has no stable object identity and cannot distinguish one
  terminal from a deleted-and-recreated terminal.
- Reason not selected: stable identity is the minimum required lifecycle fact;
  parent pin-name reconciliation remains bounded inside structural edits.

## Consequences

### Positive

- Hierarchy stays flat and modular at the package level: current model facts,
  one edit union, one structural wrapper, one resolver, and one derived index.
- A real child Port is visible, wireable, selectable, and exportable without a
  parallel renderer or endpoint type.
- Cell reuse, safe rename/delete, cycle rejection, save/reopen, export, and
  undo can be validated deterministically.
- A future layout or multi-view product can make a separate decision instead
  of being predesigned into this schema.

### Negative or limiting

- Parent hierarchy pins remain name-addressed in schema 12, so renames require
  project-wide caller reconciliation.
- Migrated formal ports are unplaced until a human or Agent positions them in
  the child schematic.
- Bus ports, parameter declarations, and multi-page schematic presentation are
  outside this decision.

## Validation

- schema-12 strict validation and direct v11 migration tests;
- formal-Port Instance/Net/interface closure tests;
- missing-target, name-mismatch, cycle, top-delete, and referenced-delete
  rejection tests;
- Project transaction atomicity, stale revision, and undo/redo tests;
- shared-Cell caller rename and navigation-path tests;
- Agent Snapshot/transaction parity and generated-artifact drift checks;
- deterministic SPICE/Spectre hierarchy export and canonical save/reopen;
- focused editor browser workflows and branch-wide verification.

## Related documents

- [`0022-current-protocol-baseline.md`](0022-current-protocol-baseline.md)
- [`0023-rolling-previous-project-compatibility.md`](0023-rolling-previous-project-compatibility.md)
- [`0024-device-protocol-and-compatibility-boundaries.md`](0024-device-protocol-and-compatibility-boundaries.md)
- [`../specs/schematic-model.md`](../specs/schematic-model.md)
- [`../specs/edit-engine.md`](../specs/edit-engine.md)
- [`../specs/netlist-export.md`](../specs/netlist-export.md)
