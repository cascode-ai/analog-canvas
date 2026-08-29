# 0027 - Stage 1 netlist authoring protocol

Status: `accepted`

Date: `2026-08-19`

Owners: `packages/model`, `packages/project-protocol`, `packages/devices`,
`packages/edit-engine`, `packages/derived`, `packages/netlist`, `apps/editor`

## Context

The schema-13 hierarchy model gives a Document an ordered, Port-Instance-backed
formal interface, and every emitting Instance already has typed netlist data.
However, the current implementation still persists an older
`Instance.properties` bag beside typed parameters, retains separate parameter
lists in device descriptors and the editor, keeps imported terminal mapping in
an editable-looking netlist field, and models external subcircuits only as an
unshared name. These parallel representations make Properties, batch editing,
reference allocation, validation, and deterministic netlist extraction
ambiguous.

Stage 1 is intentionally limited to schematic authoring as a reliable source
for a dialect-neutral design IR. It does not add simulator setup, PDK/CDF,
PCell, layout, LVS/PEX, source-preserving text round-trip, buses, or a public
Agent release. The present GUI has useful compatibility promises: current
W/L/M/value, location, and rotation edits update immediately; existing display
toggles, selection/focus, Discard, Undo/Redo, save/reopen, and free canvas text
keep their visible behavior. Unifying persistent authority alone is not reason
to alter those interactions.

## Decision

### One persisted electrical authority

The Project model applies these related facts together:

- remove `Instance.properties`;
- move source-only ordered terminal mapping to
  `Instance.importProvenance.terminalMapping`;
- add ordered `Document.netlist.formalParameters`;
- add Project-level `externalSubcircuitDefinitions`; and
- replace name-only external hierarchy binding with an explicit, stable
  external definition reference while retaining a distinct unresolved import
  state.

### Persisted electrical authority

For an emitting Instance, `netlist.reference`, `netlist.binding`, and
`netlist.parameters` are the only persisted netlist identity, target, and raw
parameter authorities. `Instance.id` remains an internal stable object ID; it
is not a netlist reference and is not renamed by numbering.

`Instance.netlist.binding` has exactly these target states:

```text
primitive / model
internal subcircuit { childDocumentId }
external subcircuit { definitionId }
unresolved subcircuit { name }
```

The internal target derives its Cell name, formal terminal order, and formal
parameters from the bound child Document. A caller does not persist a copied
child terminal interface. An external target resolves to exactly one Project
definition. An unresolved target preserves insufficient imported evidence but
blocks analyzer success; it is not silently treated as an external definition.

Non-emitting markers (including Port, ground, VDD/net-marker) do not carry a
fake `Instance.netlist` merely to meet an emitting schema. The descriptor and
analyzer recognize their marker semantics before requiring netlist data. No
second emitting/non-emitting Instance union is introduced.

`Document.netlist.formalParameters` is the ordered list of Cell parameter
names with optional raw-string defaults. Project
`externalSubcircuitDefinitions` holds stable-ID external definitions, each
with a name, ordered terminals, and the same formal-parameter shape. These are
netlist-interface facts, distinct from Cell-symbol presentation, Port marker
artwork, terminal source positions, and caller-local geometry.

### Properties, descriptors, and presentation projections

Built-in device descriptors own one ordered parameter-definition list. A
definition provides name, label, required flag, editor kind, unit hint,
placeholder, help, and display role. The Insert dialog, Properties sheet,
known-parameter validation, Preflight, and Value projection derive from that
same list. A placeholder is never an implicit persisted electrical value.

Normal authoring uses field-level typed edits for reference, binding, and
netlist-parameter patches. `set_instance_netlist` remains an initialization,
import, and migration operation, not a second product-editing protocol. All
mutations continue through the Edit Engine.

Visible Reference and Value annotations are projections, not electrical
authorities. Their classification is derived rather than persisted:

```text
annotation content == current canonical slot projection  -> canonical projection
otherwise                                                -> presentation-only attached text
```

Canvas text editing continues to edit presentation only; a hand-edited string
that happens to look like a legal reference never mutates
`netlist.reference`. Insert, the Properties Reference field, and the shared
reference planner are the semantic reference writers. Parameter changes update
only labels that still match the prior canonical Value projection. Existing
free text, styling, anchors, visibility, and the explicit Show Value behavior
remain intact. This decision adds no persistent `managed`, `detached`, or
annotation-semantic flag.

### Migration and source evidence

Before shipping the adapter, maintainers must audit every non-empty legacy
`properties` key in the compatibility corpus and current fixtures. Recognized
electrical fields (`w`, `l`, `m`, `value`, `dc`) migrate to missing typed
parameters; equal duplicate values retain the typed value; a conflicting typed
and legacy value is a structured load error. Source mapping evidence such as
`symbol.mapping.registry` is moved to typed import provenance.

Each unknown non-empty key must be explicitly classified as a deterministic
migration or a structured rejection. It must not be retained as a generic
metadata/property bag and must not be silently discarded. Empty legacy bags
are removed mechanically. Schema-13 external-subcircuit imports are grouped by
case-folded target only when their ordered mapping is consistent; that creates
one passive external definition and rewrites callers to it. Inconsistent
mapping becomes an unresolved binding with a migration diagnostic. Existing
internal child bindings map directly to their child-document ID and leave no
caller terminal copy.

### GUI and analyzer compatibility

The schema adapter and Property Sheet adapter preserve current GUI default
behavior. Existing immediate field gestures remain immediate, Discard restores
the same visible baseline, and no new Apply gesture is imposed on them. New
multi-row arbitrary-parameter editing may use an explicit Apply/Cancel
transaction. A future change to old gestures requires a separate accepted UX
target with its before/after evidence and rollback path.

`analyzeDesignNetlist(Project)` is the sole authority, evolved in place from
the original extraction implementation and retaining its `{ ir | null,
diagnostics }` result shape. Preflight and later printers consume that analyzer;
they do not create a second extraction implementation. The analyzer consumes
only typed facts and derived descriptor/interface authority, never annotations,
routes, geometry, or import provenance as substitute electrical facts.

## Alternatives considered

### Keep `Instance.properties` as a permanent adapter or dual-write path

- Benefits: less immediate migration work.
- Costs: preserves two electrical meanings for a parameter and lets new UI
  paths diverge from extraction.
- Reason not selected: the bounded direct migration is safer than permanent
  ambiguity.

### Add generic metadata and annotation-state fields

- Benefits: unknown imports and label edits could be retained without a
  classification decision.
- Costs: recreates a property back door and invents state without a user-facing
  lifecycle.
- Reason not selected: source evidence is typed, and label state is already
  deterministically derivable from its projection.

### Design simulation/PDK or layout containers now

- Benefits: resembles a broader Virtuoso-style database.
- Costs: invents process and physical signoff semantics that this product
  cannot validate.
- Reason not selected: a complete schematic authoring and design-IR contract is
  the prerequisite, not a subset of those systems.

## Consequences

### Positive

- Every exported circuit fact has one persisted source and one typed editing
  path.
- Descriptor-driven UI and Preflight can agree without UI-local parameter
  lists.
- Imported uncertainty remains visible and cannot masquerade as an authored,
  resolved interface.
- S3 through S7 can share reference, interface, and analyzer contracts instead
  of growing parallel protocols.

### Negative or limiting

- The direct schema-13-to-14 migration rejects ambiguous legacy electrical
  data rather than guessing a result.
- Stage 1 must complete its corpus audit before implementation can claim broad
  Project-file compatibility.
- External black-box interface authoring is Project-local; it is not a PDK or
  model-library mechanism.

## Validation

- a checked migration-corpus audit with key-by-key disposition;
- strict schema-14 model validation, direct schema-13 parse/migrate/save/reopen
  tests, and rejected ambiguous-input tests;
- descriptor/property-sheet/editor parity tests for typed parameter edits and
  projection preservation;
- hierarchy/external-definition/interface-order and non-emitting-marker tests;
- analyzer determinism, Preflight diagnostic/navigation, and no-annotation
  authority tests;
- focused GUI save/reopen, Undo/Redo, Discard, canvas-text, and immediate-field
  regression tests; and
- documentation and generated-contract checks plus the normal branch gate
  proportionate to the final changed surface.

## Related documents

- [`0023-rolling-previous-project-compatibility.md`](0023-rolling-previous-project-compatibility.md)
- [`0024-device-protocol-and-compatibility-boundaries.md`](0024-device-protocol-and-compatibility-boundaries.md)
- [`0025-schematic-hierarchy-and-formal-ports.md`](0025-schematic-hierarchy-and-formal-ports.md)
- [`0026-definition-level-cell-symbol-presentation.md`](0026-definition-level-cell-symbol-presentation.md)
- [`../specs/schematic-model.md`](../specs/schematic-model.md)
- [`../specs/edit-engine.md`](../specs/edit-engine.md)
- [`../specs/netlist-export.md`](../specs/netlist-export.md)
