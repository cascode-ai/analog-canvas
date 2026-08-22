# Schematic Edit Engine

Status: `accepted`

Version: `1.13`

Owning phase: `Phase 0/1/8`

Primary owner: `packages/edit-engine`

Related ADRs: [`0013-project-connectivity-index.md`](../adr/0013-project-connectivity-index.md),
[`0014-resolved-route-geometry.md`](../adr/0014-resolved-route-geometry.md).
Routing planners (WP-R4) read the unified connectivity index and resolved route
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

- control/history: `noop`, `clear_document`, `undo`, `redo`;
- Instance: `add_instance`, `remove_instance`, `set_instance_symbol`,
  `place_instance`, `unplace_instance`, `move_instance`, `rotate_instance`,
  `mirror_instance`,
  `set_instance_reference`, `set_instance_schematic_reference`,
  `set_instance_schematic_name`, `set_instance_binding`,
  `patch_instance_netlist_parameters`, `bulk_patch_instance_netlist`,
  `set_instance_netlist`;
- Cell interface: `add_cell_terminal`, `update_cell_terminal`,
  `remove_cell_terminal`, `reorder_cell_terminals`,
  `set_cell_formal_parameters`;
- Route/Junction/connectivity: `set_route_points`, `route_orthogonal`,
  `add_junction`, `attach_endpoint_to_route`, `remove_junction`,
  `move_junction`, `remove_route_geometry`, `cut_connection`, `connect_endpoints`,
  `disconnect_endpoint`;
- Net/power/MOS: `add_power_rail`, `merge_nets`, `set_net_name`,
  `set_net_power_domain`, `set_mos_bulk_defaults`,
  `reconcile_mos_bulk`, `clear_mos_bulk_default`;
- explicit open terminal: `add_no_connect`, `remove_no_connect`;
- presentation/layout: `set_presentation_style`, `set_cell_symbol_presentation`,
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
changing netlist output; formal Cell Ports use their terminal name and reject
this edit. `set_instance_schematic_name` instead changes the user-owned
RichText label shown on an ordinary schematic instance. Port character edits
rename their bound `Net.name` or `CellTerminal.name`; a formatting-only edit
upserts the same-text `Annotation.formatOverride`. A Cell-terminal character
edit uses the structural hierarchy planner so caller pins and the netlist
interface reconcile atomically. `bulk_patch_instance_netlist` is the bounded,
atomic multi-instance netlist form. `set_instance_netlist` remains
the whole-record operation for object initialization, import, and bounded
migrations; product editing must not rebuild unrelated netlist facts through
it.
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

Deleting an anchor target is non-cascading and non-rejecting: the same
transaction that removes a Route or Instance/Junction updates each
attached object's `fallbackPosition` and marks its anchor unresolved, but does
not delete the attached object and does not reject the delete. Content locks do
not block this fallback maintenance. `upsert_drafting_object` for a
floating-symbol validates `symbolId` against the Symbol Resolver and rejects a
non-`decorative` entry or a `decorative` entry whose definition contains a
terminal, mirroring `add_instance` Symbol validation. Locked drafting objects
reject user replacement or removal, matching the existing lock
discipline.

`clear_document` is one atomic human/Agent edit. It removes all authored
electrical, annotation, layout-intent, and drafting records from the targeted
Document while preserving Document identity, presentation, source binding,
and transaction history. Because it crosses topology and presentation, it
advances revision once, marks connectivity modified, and is restored by one
Undo.

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
  edit path. The Edit Engine never silently snaps an Agent or import payload.
- Locked annotation and layout-intent records cannot be replaced or removed.
- Moving or aligning an instance translates its attached annotations by the
  same delta in the same atomic transaction.
- A locked layout group or constraint rejects transforms of any referenced
  instance, so a multi-object transaction cannot move only an unlocked subset.
- Instance/topology authoring sets `sourceStatus` to
  `connectivity-modified`; geometry-only edits preserve the prior status
  transition.

Phase 8 topology operations have these preconditions:

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
  reference.
- `place_instance` and `unplace_instance` require an unlocked Instance.
  `unplace_instance` returns a placed Instance to the Placement
  Tray. It preserves Net membership, NoConnects, bindings, parameters, and
  annotations, but rejects while a Route still terminates at the Instance.
- `connect_endpoints` creates a caller-named local Net when both endpoints are
  unowned, or attaches an unowned endpoint to the other endpoint's Net.
- `set_net_name` requires a non-empty trimmed name. A name already owned by a
  different Net after case-folded comparison is rejected; the caller must
  explicitly `merge_nets`.
- `planEnsureNamedNet` is the pure high-level companion for an existing
  candidate Net. It returns only `set_net_name` or `merge_nets` edits: an
  unused name renames the candidate, while an existing same-folded name selects
  a deterministic target and explicitly merges compatible Nets. It does not
  weaken the raw edit's rejection rule or create another mutation endpoint.
- `set_net_power_domain` may classify an unclassified Net or clear a role, but
  cannot change directly between non-`none` roles. Canonical power authoring
  selects by Net name before applying this edit; a power role alone never
  selects a Net.
- `add_power_rail` requires an explicit trimmed `netName` and scope, creates or
  reuses exactly that named compatible Net, and binds its RichText annotation
  to the Net name. It does not infer identity from `powerDomain`.
- Power-Net normalization is not an edit operation. Normal production
  authoring uses the name-first power and named-Net planners; a transaction
  cannot silently add a canonical name, change scope, or repair a duplicate
  Net after the caller's explicit edits have run.
- `move_junction` preserves topology and must be paired with `set_route_points`
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
- Endpoints on different Nets require an explicit preceding `merge_nets` edit
  in the same transaction.
- `merge_nets` retargets routes, junctions, annotations, and layout references
  before removing the source Net.
- `disconnect_endpoint` requires all route geometry that uses the endpoint to
  be removed explicitly first.
- `cut_connection` requires one existing unlocked Route. If the Net is fully
  routed, removing a bridge deterministically partitions its endpoints,
  Junctions, and remaining Routes into local Nets; removing a redundant cycle
  keeps the original Net. For global Nets and Nets that already had multiple
  routed components, the Route is removed while logical membership is retained
  so the derived layer can restore flightlines without guessing at an
  electrical split. Newly orphaned Junction endpoints of the deleted branch
  are removed, an empty local Net is removed, and attached annotations follow
  the normal unresolved-anchor fallback rule.
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
- GUI/Agent parity tests for Phase 8 authoring operations

## Open decisions

- In-memory `DocumentHistory` retains at most 64 undo or redo snapshots per
  opened Document. It is a session-memory budget, not persisted Project data;
  callers may supply a smaller or larger positive limit for a constrained host.
- Persistent history, history compaction, and recovery integration remain
  deferred; Phase 1 history is validated in-memory session state.
