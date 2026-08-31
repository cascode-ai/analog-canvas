# Schematic Edit Engine

Status: `accepted`

Version: `1.13`

Primary owner: `packages/edit-engine`

Related ADRs: [`0013-project-connectivity-index.md`](../adr/0013-project-connectivity-index.md),
[`0014-resolved-route-geometry.md`](../adr/0014-resolved-route-geometry.md),
[`0041-physical-cut-and-endpoint-readiness.md`](../adr/0041-physical-cut-and-endpoint-readiness.md).
Routing planners read the unified connectivity index and resolved route
geometry as read-only input; the Edit Engine remains the sole mutation path and
validates every edit independently without trusting the planner.

## Purpose

Define the only committed mutation path for both GUI and Agent operations,
including revision checks, dry runs, atomicity, results, and diagnostics.

## Consumers

- editor GUI tools
- Agent adapter
- history and undo/redo
- model validators and diagnostics

## Terminology

| Term        | Meaning                                                                  |
| ----------- | ------------------------------------------------------------------------ |
| Transaction | One atomic ordered list of typed edits against one Document revision     |
| Dry run     | Full validation and diff prediction without mutation or revision advance |
| Preflight   | Validation performed before any candidate mutation is committed          |

## Data model or interface

Routing gestures and planners cross one transient `RoutingOperationPlan`
boundary before commit. The plan carries the source revision, typed edits,
affected closure, stable-ID remap and an explicit expected electrical effect.
`evaluateRoutingOperationPlan()` runs the same transaction used by commit and
independently compares before/after electrical projections. The evaluated
Document is the only valid full preview; the plan has no untyped preview
payload and is not persisted. NoConnect and unrelated drafting/presentation
edits continue to use the ordinary transaction directly.

```typescript
interface EditTransaction {
  transactionId: string;
  documentId: string;
  expectedRevision: number;
  actor: { kind: "human" | "agent"; id: string };
  dryRun?: boolean;
  edits: SchematicEdit[];
}
```

`packages/edit-engine/src/transaction.ts` exports `SchematicEditSchema`, the
sole executable list of typed edit kinds. The current union is grouped below
for readability; these groups do not create separate mutation endpoints:

<!-- schematic-edit-kinds:start -->

- control/history: `noop`, `undo`, `redo`;
- Cell lifecycle: `clear_cell_drawing`, `reset_cell_placement`,
  `reset_cell_body`;
- Instance: `add_instance`, `remove_instance`, `set_instance_symbol`,
  `place_instance`, `unplace_instance`, `move_instance`, `rotate_instance`,
  `mirror_instance`,
  `set_instance_reference`, `set_instance_schematic_reference`,
  `set_instance_schematic_name`, `set_instance_style_override`,
  `set_instance_signal_flow_parameters`,
  `set_instance_binding`,
  `patch_instance_netlist_parameters`, `bulk_patch_instance_netlist`,
  `set_instance_netlist`;
- Cell interface: `create_cell_interface`, `add_cell_terminal`, `update_cell_terminal`,
  `remove_cell_terminal`, `reorder_cell_terminals`,
  `set_cell_formal_parameters`;
- Route/Junction/connectivity: `set_route_path`, `route_orthogonal`,
  `add_junction`, `attach_endpoint_to_route`, `remove_junction`,
  `move_junction`, `remove_route_geometry`, `cut_connection`, `connect_endpoints`,
  `disconnect_endpoint`;
- Net/power/MOS: `create_base_net`, `add_power_rail`, `merge_nets`,
  `upsert_connectivity_evidence`, `remove_connectivity_evidence`,
  `set_mos_bulk_defaults`,
  `reconcile_mos_bulk`, `clear_mos_bulk_default`;
- explicit open terminal: `add_no_connect`, `remove_no_connect`;
- presentation/layout: `set_presentation_style`, `set_route_style_override`,
  `set_cell_symbol_presentation`,
  `upsert_schematic_annotation`, `remove_schematic_annotation`,
  `upsert_drafting_object`, `remove_drafting_object`, `set_layout_group`,
  `remove_layout_group`, `set_layout_constraint`,
  `remove_layout_constraint`, `align_instances`.

<!-- schematic-edit-kinds:end -->

The Agent Document transaction schema is derived from this union, applies its
scope restrictions, and excludes unsupported history kinds. Formal-interface
edits are submitted inside `structureEdits`, which composes the same union with
add/remove Document operations under one Project `structureRevision`. Agent
capability `wire`
advertises the mutually exclusive high-level `wireIntent` transaction form; it
is not another `SchematicEdit` member.

`set_instance_reference`, `set_instance_binding`, and
`patch_instance_netlist_parameters` are the ordinary field writers for an
existing netlist record. `set_instance_schematic_reference` changes the visible
Reference for any non-formal Instance, including a non-emitting Port, without
changing netlist output; Cell Pins use their terminal name and reject
this edit. `set_instance_schematic_name` instead changes the user-owned
RichText label shown on an ordinary schematic instance. Net
Label character edits update their owner-addressed name claim; formal Port
character edits rename only the selected `CellTerminal.name`; a case-folded
duplicate is valid and never invokes `merge_nets`. A formatting-only edit
upserts the same-text `Annotation.formatOverride`. A Cell-terminal character
edit uses the structural hierarchy planner so the before/after projected
caller interface reconciles atomically. A surviving old-name group leaves
callers untouched; joining an existing group detaches the disappearing caller
pin rather than merging it with the target pin. `bulk_patch_instance_netlist` is the bounded,
atomic multi-instance netlist form. `set_instance_netlist` remains
the whole-record operation for object initialization, import, and bounded
migrations; product editing must not rebuild unrelated netlist facts through
it.
`set_instance_signal_flow_parameters` is a separate schematic-only whole-object
writer for Transfer Function metadata (`formula`, `coefficient`, `bodyWidth`,
`bodyHeight`). Width and height are optional 10-unit-grid minimum frame sizes;
the shared renderer may expand beyond them to preserve the fixed formula font
size and padding. The edit never merges into or rebuilds
`Instance.netlist.parameters`; `null` or `{}` clears the field, and a non-null
object replaces the current Signal Flow metadata atomically. Geometry-dependent
pin endpoints, hit bounds, routes, and untouched canonical instance labels are
re-derived from the same layout contract; user-moved labels stay authored.
Parameter patches construct one final record before commit: an unset followed
by a set permits a case-only rename, while a final case-folded duplicate is
rejected atomically. This is the shared contract for descriptor fields and the
Additional Parameters table.

`upsert_schematic_annotation` / `remove_schematic_annotation` replace the
narrowed SchematicAnnotation set (`instance-label | instance-value |
net-label | power-label | route-marker`). `upsert_drafting_object` / `remove_drafting_object` accept the
`DraftingObject` union (text, arrow, leader, callout, construction-line,
floating-symbol) with the shared `VisualAnchor`. None of these edits creates or
modifies a Net, Route,
Junction, flightline, Pin, or SPICE instance. A `transact` dry run returns:
resolved anchors, invalid/unresolved attachments, possible overlaps with
electrical objects, and the actual changed IDs.

Deleting an Instance or Junction anchor target is non-cascading and
non-rejecting: the same transaction updates each attached object's
`fallbackPosition` and marks its anchor unresolved, but does not delete the
attached object. Route-anchored annotations are explicit deletion closure:
`remove_route_geometry` and `cut_connection` reject until a preceding typed
edit removes them. Content locks do not block fallback maintenance.
`upsert_drafting_object` for a floating-symbol validates `symbolId` against the
Symbol Resolver and rejects a non-`decorative` entry or a `decorative` entry
whose definition contains a terminal, mirroring `add_instance` Symbol
validation. Locked drafting objects reject user replacement or removal,
matching the existing lock discipline.

The old unscoped `clear_document` edit is retired. Cell removal now uses three
atomic, browser-editor lifecycle edits planned by `cell-reset-planner.ts`:
`clear_cell_drawing` removes only Route/drafting geometry,
`reset_cell_placement` returns Instances to the tray and removes placement
geometry/intent, and `reset_cell_body` removes non-interface content while
retaining formal terminals and their marker/Net projection. Each advances the
Document revision once and is restored by one Undo. The public Agent surface
categorizes these guarded UI lifecycle edits as unsupported.

`upsert_connectivity_evidence` and `remove_connectivity_evidence` are the only
atomic writers for the current connectivity-evidence list. Upsert replaces
evidence with the same ID or inserts a new record after checking the shared
Document object namespace; final Document validation checks every Net and
owner reference.
Removing an Instance, Net Label, Junction, or Route also removes only
`name-claim` evidence that names that object as its owner. A source-unbacked
legacy Net-property projection shadowed by that owner retires with it; an
imported node name remains while its Base Net still has structural reachability.
Evidence describes a Base Net but is not itself Net reachability. When the last
terminal, Route/Junction, formal interface, Annotation, layout reference, or
materialized MOS binding disappears, cleanup removes the Base Net together with
its Net-property and SPICE-source evidence. The Document source binding remains
as import provenance. Cleanup
of evidence-bearing candidates is deferred to the transaction boundary so
ordered edits can still remove or replace their evidence atomically; evidence
explicitly upserted by that transaction remains subject to final validation.
Reset Cell Body previews and removes non-interface evidence while retaining
assertions whose complete Net and owner closure survives. The public Agent
surface classifies both evidence edits as unsupported.

`hierarchy-planner.ts` is the shared pure orchestration boundary above these
edits. It constructs canonical subcircuit Instances and plans Cell
creation/placement, rename/delete, formal-Port lifecycle, and terminal visual
intent as ordinary Project structure edits. It does not execute transactions,
own UI state, or define another hierarchy representation. Canvas-dependent
contact detection and placement previews remain consumer concerns; read-only
Cell/caller summaries are derived data owned by `@icm/derived`.

## Invariants

- A Schematic transaction targets exactly one Document. A Project structural
  transaction atomically composes ordered Schematic transactions with
  add/remove Document operations and validates the complete final Project.
- `expectedRevision` must equal the current revision.
- The complete payload is schema-validated before application.
- All edits apply or none apply.
- A rejected transaction returns the original Document object and revision.
- A successful committed transaction advances revision exactly once.
- Dry run returns a proposed revision and deterministic diff but preserves the
  current Document and revision.
- GUI and Agent callers cannot bypass Document validation.
- Every typed-edit page Point is validated against the target Document grid;
  schema-valid integers that are not grid-aligned reject atomically with their
  edit path. Page points are enumerated by edit kind rather than found by a
  recursive `{x,y}` scan, so derived and symbol geometry are not mutation
  coordinates. The Edit Engine never silently snaps an Agent or import payload.
- Locked annotation and layout-intent records cannot be replaced or removed.
- Moving or aligning an instance translates its attached annotations by the
  same delta in the same atomic transaction.
- A locked layout group or constraint rejects transforms of any referenced
  instance, so a multi-object transaction cannot move only an unlocked subset.
- Instance/topology authoring sets `sourceStatus` to
  `connectivity-modified`; geometry-only edits preserve the prior status
  transition.

Topology operations have these preconditions:

- `add_instance` requires a globally unused object ID and resolvable Symbol.
- `set_instance_symbol` requires a resolvable target Symbol/variant. Every
  connected or routed source pin must either already exist on that Symbol or be
  covered by an explicit one-to-one `pinMap`; the edit atomically updates Net,
  Route, and preserved `spice.pin.*` references without changing Net ownership.
- `port` and `port-filled` use the ordinary `add_instance`, `place_instance`,
  `unplace_instance`, `move_instance`, and terminal-connectivity edit paths; there is no
  Port-specific edit kind.
- `set_cell_symbol_presentation` changes only a Cell definition's optional
  stable-terminal visual intent. It is wrapped in a Project structural
  transaction so caller Symbol geometry and route following reconcile together;
  it creates no endpoint or drawing-object kind.
- `remove_instance` requires no Net, annotation, group, or constraint
  reference. Owner-addressed Connectivity Evidence is cleaned atomically and
  does not make an otherwise removable Instance permanent.
- `place_instance` and `unplace_instance` require an unlocked Instance.
  `unplace_instance` returns a placed Instance to the Placement
  Tray. It preserves Net membership, NoConnects, bindings, parameters, and
  annotations, but rejects while a Route still terminates at the Instance.
- `connect_endpoints` creates a caller-named local Net when both endpoints are
  unowned, or attaches an unowned endpoint to the other endpoint's Net.
- `planEnsureNamedNet` is the pure high-level companion for an existing
  candidate Base Net, stable evidence ID, and addressable owner. It emits
  `upsert_connectivity_evidence` only: matching scoped claims remain separate
  physically and resolve to one Logical Net. It never emits `merge_nets` or a
  new `Net.name` projection. If the candidate has an imported name claim, the
  edit updates that owned fact deliberately; it does not create another
  mutation endpoint.
- `add_power_rail` requires an explicit trimmed `netName` and scope, creates a
  physical Base Net when needed, and authors the same marker claim used by VDD
  symbols. Its RichText annotation is bound to that claim. It does not infer
  identity from `powerDomain` or physically merge by name.
- Power-Net normalization is not an edit operation. Normal production
  authoring uses the name-first power and named-Net planners; a transaction
  cannot silently add a canonical name, change scope, or repair a duplicate
  Net after the caller's explicit edits have run.
- `move_junction` preserves topology and must be paired with `set_route_path`
  edits for every incident Route whose geometry changes in the same
  transaction. GUI movement planners always author those Route edits; Routes
  protected by locked geometry reject the move.
- `move_instance` stretches unprotected connected Routes under their existing
  geometry constraint (orthogonal, octilinear, or free; ADR 0009, ADR 0028, and
  ADR 0039). A
  Route with a locked/trunk adjacent segment is
  skipped; if the caller does not re-point it in the same transaction, the
  post-loop validation rejects with `INVALID_RESULT` naming the Route. The
  touched Routes appear in the transact `resolvedRoutes` response field.
- `add_junction` normally requires an existing Net. `createNet: true` permits
  creation of the named empty local Net in the same edit, enabling a free wire
  endpoint without a second mutation path.
- Connected-instance deletion remains a composed transaction rather than a
  destructive `remove_instance` flag: Routes are first repointed to replacement
  Junctions, terminals, NoConnects, instance-owned annotations, and unlocked
  layout references are removed explicitly, and only then is the unreferenced
  instance removed.
- Explicit `connect_endpoints` and `attach_endpoint_to_route` edits on different
  Nets require their planned merge in the same transaction. Independently,
  final exact endpoint coincidence and explicit Junction-on-route contact are
  normalized by the transaction itself, using the same Base-Net merge path.
- `merge_nets` retargets routes, junctions, annotations, and layout references
  before removing the source Net.
- `disconnect_endpoint` requires all route geometry that uses the endpoint to
  be removed explicitly first.
- `cut_connection` requires one existing unlocked Route. Removing a bridge
  partitions the affected Base Net by remaining explicit Routes and confirmed
  direct contacts; global, imported, and logical-name Evidence never suppress
  that physical split. A redundant cycle keeps the original Base Net.
  The component containing the deleted Route's `from` endpoint retains the
  original Base-Net ID; detached components receive deterministic new IDs.
  Newly orphaned Junction endpoints are removed. Route-anchored annotations
  must be removed by a preceding typed edit in the same transaction.
- `remove_route_geometry` is the explicit geometry-only operation: it removes
  a Route while preserving logical Net membership. It supports advanced
  rerouting without conflating a persisted mutation with derived guidance.
- symbol and Instance edits honor the same locked layout groups/constraints as
  instance transforms and reject the complete transaction on conflict.

## Operations and state transitions

```text
schema → document identity → revision → preflight → candidate apply
→ deterministic validation → commit revision + 1
```

`STALE_REVISION`, `DOCUMENT_MISMATCH`, and validation errors are typed failures.
Undo and redo require a `DocumentHistory` session. They restore prior validated
Document content while creating a new monotonically increasing revision; they
never decrement or reuse a revision. A new normal edit clears the redo stack.

## Persistence boundary

Only the resulting Document and its revision are persisted. Transactions,
preflight state, diffs, diagnostics, and history implementation data are
runtime state unless a later recovery contract explicitly snapshots them.

## Valid example

One transaction adds two resistors, connects two pins into a caller-named Net,
and adds its Route. It commits one revision and sets `sourceStatus` to
`connectivity-modified`; failure of any later edit restores the exact input.

## Rejected example

A transaction with `expectedRevision: 8` against revision 9 returns
`STALE_REVISION`; no edit is evaluated and the original Document is returned.

## Contract evolution

The current strict edit union is the only accepted authoring contract. Changing
an existing kind or adding a kind requires coordinated model, Agent schema,
permission, transaction, and parity validation. There is no compatibility edit
adapter.

ADR 0010 defines the current drafting/annotation edit kinds. The annotation
protocol exposes only `upsert_schematic_annotation` and
`remove_schematic_annotation`; retired ambiguous edit names are invalid.

## Deterministic validation

- stale revision and Document mismatch tests
- schema rejection before apply
- atomic no-op and dry-run tests
- GUI/Agent parity tests for authoring operations

## Open decisions

- In-memory `DocumentHistory` retains at most 64 undo or redo snapshots per
  opened Document. It is a session-memory budget, not persisted Project data;
  callers may supply a smaller or larger positive limit for a constrained host.
- Persistent history, history compaction, and recovery integration remain
  deferred; history is validated in-memory session state.
