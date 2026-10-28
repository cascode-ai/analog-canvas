# Schematic Edit Engine

Status: `accepted`

Primary owner: `packages/edit-engine`

The only committed mutation path for GUI and Agent.
[`SchematicEditSchema`](../../packages/edit-engine/src/edit-schema.ts) owns the
envelope and the sole list of edit kinds; the Agent schema derives from it.
Changing or adding a kind needs coordinated model, Agent schema, permission,
transaction and parity validation; retired names are invalid (no adapter).
Rationale: [Net](../adr/net-connectivity.md), [routing](../adr/routing.md).

## Operations and state transitions

```text
schema → document identity → revision → preflight → candidate apply
→ deterministic validation → commit revision + 1
```

- A Schematic transaction targets one Document. A Project structural
  transaction composes ordered Schematic transactions with add/remove/rename
  Document, source-file, external-definition and simulation-folder edits
  under one `structureRevision`, and validates the complete final Project.
- `expectedRevision` must equal the current revision; the whole payload is
  schema-validated first; all edits apply or none; a rejection returns the
  original Document and revision; a commit advances revision exactly once; a
  dry run returns a proposed revision and deterministic diff without change.
  `STALE_REVISION`, `DOCUMENT_MISMATCH` and validation errors are typed.
- Every page Point is validated against the Document grid, enumerated per
  edit kind (derived/symbol geometry is never a mutation coordinate). Off-grid
  values reject atomically with their path; nothing is silently snapped.
- External-subcircuit callers: a transaction is refused (`INVALID_RESULT`,
  naming part, Cell and the ways out: disconnect, clear model, delete) when it
  leaves a caller using a pin its definition lacks or drawing a
  property-only terminal that was not already so. A caller already in that
  state is reported by export and blocks nothing else.
- Locked annotation, layout-intent and drafting records cannot be replaced or
  removed. A locked group or constraint rejects transforms of any referenced
  instance (no partial moves); symbol and Instance edits honor the same locks.
- Moving or aligning an instance moves its attached annotations in the same
  transaction.
- Instance/topology authoring sets `sourceStatus` to `connectivity-modified`;
  geometry-only edits keep the prior status.
- Only the resulting Document and revision persist; transactions, diffs,
  diagnostics and history are runtime state.

## Routing plans

Routing gestures cross one transient `RoutingOperationPlan` (source revision,
typed edits, affected closure, ID remap, expected electrical effect); the
engine re-validates it. `evaluateRoutingOperationPlan()` runs the commit
transaction and compares electrical projections; its Document is the
authoritative electrical preview. Per-frame previews may project coordinate
edits into a transient Document (no revision, normalization or
certification), but content, binding, identity and topology changes need the
evaluated preview; release commits the prepared proposal through the strict
gate.

## Edit rules

- `set_instance_reference` writes the sole authored Reference (shown by
  `instance-reference` annotations, emitted when bound); Cell Pins reject it.
- Net Label text edits update the owner's name claim; formal Port text edits
  rename only `CellTerminal.name` via the hierarchy planner so caller
  interfaces reconcile atomically (a surviving old-name group leaves callers
  alone; joining an existing group detaches the vanishing caller pin). A
  case-folded duplicate is valid and never `merge_nets`. Formatting-only edits
  upsert `Annotation.formatOverride`. A display alias's edits change only its
  text ([names and labels](names-and-labels.md#two-facts)).
- `set_instance_binding` and `patch_instance_netlist_parameters` are the
  netlist field writers; `bulk_patch_instance_netlist` is the bounded
  multi-instance form; `set_instance_netlist` (whole record) is for
  initialization, import and migrations only. Patches build one final record:
  unset-then-set allows a case-only rename; a final case-folded duplicate
  rejects.
- `set_instance_signal_flow_parameters` replaces Transfer Function metadata
  (`formula`, `coefficient`, `bodyWidth`, `bodyHeight`; sizes are optional
  10-grid minimums) without touching netlist parameters; `null`/`{}` clears.
  Pins, bounds, routes and untouched labels re-derive; moved labels stay.
- Annotation edits (`upsert/remove_schematic_annotation`, kinds
  `instance-label | instance-value | net-label | power-label | route-marker`)
  and drafting edits (`upsert/remove_drafting_object`) never touch Nets,
  Routes, Junctions, Pins or SPICE. Dry run reports resolved anchors,
  unresolved attachments, possible overlaps and changed IDs. A
  floating-symbol must resolve to a `decorative` Symbol without terminals.
- Deleting an Instance or Junction anchor target updates each attached
  object's `fallbackPosition` and marks it unresolved (no cascade or reject).
  Route-anchored annotations must be removed by a preceding edit before
  `remove_route_geometry`/`cut_connection`.
- Cell lifecycle (`cell-reset-planner.ts`, connectivity permission for
  Agents): `clear_cell_drawing` removes Route/drafting geometry;
  `reset_cell_placement` returns Instances to the tray; `reset_cell_body`
  removes non-interface content, keeping formal terminals. Resets that remove
  every Route re-anchor Route-bound Net/power labels free so names survive;
  route markers go. Each is one revision and one Undo.
- `upsert/remove_connectivity_evidence` write evidence; `migrate_label_signal`
  updates only its owning Label's claim and member identities atomically with
  conductor and selector changes. IDs and final references are validated.
  Removing an owner
  removes only `name-claim` evidence it owns (plus a source-unbacked legacy
  Net-property projection it shadows; an imported node name stays while its
  Base Net is reachable). A Base Net with no remaining
  terminal, Route/Junction, interface, annotation, layout reference or MOS
  binding is removed with its Net-property and SPICE-source evidence; cleanup
  of evidence-bearing candidates waits for the transaction boundary.
  `reset_cell_body` keeps assertions whose Net and owner closure survive.
- `set_inductor_coupling` creates or replaces one coupling of two distinct
  drawn inductors (`dotPin` one of each one's pins, no pair twice, unique
  names); deleting an inductor removes its couplings; a coupled inductor can
  only be swapped for another inductor Symbol.
- `add_instance` needs an unused ID and resolvable Symbol.
  `set_instance_symbol` needs every connected/routed pin to exist on the
  target or be covered by a one-to-one `pinMap`, updating Net, Route and
  `spice.pin.*` references atomically. Ports use ordinary Instance edits.
- `set_cell_symbol_presentation` (inside a structural transaction) changes
  only terminal visual intent; caller pins keep their Nets; a stretched wire
  that would cross another Net's pin or wire, or a part, is redrawn clear
  along the Agent connect's path.
- `remove_instance` needs no Net, annotation, group or constraint reference
  (owned evidence is cleaned). Connected deletion is a composed transaction,
  not a flag.
- `place_instance`/`unplace_instance` need an unlocked Instance; unplacing
  keeps Net membership, NoConnects, bindings, parameters and annotations but
  rejects while a Route ends there. On every Project open the editor runs
  `planUndrawnInstancePlacements`, drawing off-sheet Instances on a shelf
  below the drawing.
- `connect_endpoints` creates a caller-named local Net or attaches an unowned
  endpoint; endpoints on different Nets need their merge in the same
  transaction. Exact endpoint coincidence and Junction-on-route contact are
  normalized by the transaction via the Base-Net merge path.
- `planEnsureNamedNet` emits only `upsert_connectivity_evidence` (matching
  claims resolve to one Logical Net), never `merge_nets` or `Net.name`.
- `add_power_rail` needs a trimmed `netName` and scope and authors the same
  marker claim as VDD symbols; it never infers identity from `powerDomain`.
  Power-Net normalization is not an edit: transactions never add names,
  change scope or repair duplicates on their own (the bounded legacy
  marker-ownership capture before a cut only keeps an already-resolved
  supply identity).
- `move_junction` must be paired with `set_route_path` for each changed
  incident Route or `remove_route_geometry` for a collapsed one; locked
  geometry rejects. `move_instance` stretches unprotected Routes under their
  constraint; a Route with a locked/trunk adjacent segment left un-repointed
  rejects with `INVALID_RESULT`; touched Routes return in `resolvedRoutes`.
- `add_junction` needs an existing Net unless `createNet: true`.
- `merge_nets` retargets everything before removing the source Net.
  `disconnect_endpoint` needs prior removal of the endpoint's geometry.
  `cut_connection` (unlocked Route) applies the
  [Wire cut lifecycle](connectivity-and-routing.md#wire-cut-lifecycle).
  `remove_route_geometry` removes a Route but keeps Net membership.
- `upsert/remove_simulation_folder` address one version-4 folder by ID; an
  identical upsert or absent removal is no change. Removing a bound Cell or
  file may leave preparation diagnostics, never an unsaveable Project
  ([simulation](simulation.md)).

## Planners

Pure planners emit ordinary edits and never execute or own UI state:
`hierarchy-planner.ts`, `cell-pin-planner.ts`,
`cell-interface-change-planner.ts`, `device-model-target-planner.ts` and
`project-cell-import.ts` (cross-Project copy, shared by GUI and the Agent
`project_cells` resource; deterministic remapping makes re-import idempotent
with no live link). Cell/caller summaries belong to `@icm/derived`.

## Session history

[EditorDocumentController](../../apps/editor/src/document/document-controller.ts)
keeps one chronological history per open Project working copy (Document and
structural commits, ≤ 64 entries per stack). GUI Undo follows commit order
across Cells; Agent Undo cannot skip a newer entry for another Cell (the
rejection names it) and structural Agent Undo checks
`expectedStructureRevision`. Whole-Project replacement starts a new history;
Cell or tab switches do not. Restores create new increasing revisions and
restore model definitions; a new commit clears redo, rejected, dry-run and
no-op edits do not. [DocumentHistory](../../packages/edit-engine/src/history.ts)
serves standalone consumers only. History is never persisted
([deferred](../roadmap/README.md#deferred-contract-questions)).
