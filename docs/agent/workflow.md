# Agent schematic workflow

Owner: `circuit-layout` Skill. Strength: hard for process and handoff; no
authority to change electrical topology. Trigger: every Agent layout, routing,
repair, render, or review task.

This page defines the shortest reliable path from circuit facts to a reviewed
editable schematic. It coordinates existing tools; it does not introduce a
planning schema, router, or second mutation path.

## Execution path

Agent layout work uses the live product: an editor or host session owns the
Project, the current complete Snapshot is the source of truth, and every
mutation is a current typed `transact`.

The GUI is for human direct manipulation and visual handoff. An Agent should
not place or wire many objects by mouse when the typed API is available.

## Run the layout loop

### 1. Establish the contract

For a live session, start from the capabilities example in the deployed
OpenAPI, call `capabilities` once, and use only the returned operations,
Snapshot version, permissions, edit kinds, and limits. Record
`maxTransactionEdits`, `maxSnapshotBytes`, `maxRenderBytes`, selected
`documentId`, and current `revision`.

### 2. Read electrical facts before drawing

Read one complete selected Document Snapshot. Build an internal graph from all
instances, resolved pins, Nets, terminal membership, formal cell-terminal
mappings, hierarchy references, Routes, Junctions, annotations, placements,
locks, and diagnostics.

Separate:

- confirmed connectivity and device semantics;
- functional hypotheses such as differential pair or mirror;
- visual choices such as grouping, orientation, trunk, and labels;
- unresolved facts that block an honest drawing.

Do not flatten merely to avoid reading hierarchy. Flatten only when the user
asks for a transistor-level view or when the flat view is itself the target.

### 3. Place before detailed routing

Choose a coherent visual organization, place functional neighborhoods, and
reserve wiring and label corridors. Preserve clear existing work and human
locks. Establish the main signal path before secondary power, bias, clock, and
control distribution.

### 4. Decide visible Net topology

For each Net in the active area, decide explicitly which endpoints connect by
direct Route, local branch, shared trunk/rail, or attached local labels. The
Agent decides this graph from the circuit; no helper may infer it.

When using `@icm/agent-routing`, provide a complete transient RouteGraph:
electrical endpoints, real branch nodes, dot-free bend nodes, label anchors,
and octilinear edges. Keep terminal escape edges axis-aligned with their
declared outward direction. Use the helper only to snap, validate, fold bends
into waypoints, and produce typed edits.

### 5. Expand, dry-run, and commit atomically

Treat any RouteGraph expansion conflict as no output: revise placement or the
graph. Do not submit a partial expansion. Keep each transaction within the
advertised limit and use the exact current revision. Dry-run connectivity,
destructive, multi-object, and non-trivial routing changes before commit.

On `STALE_REVISION`, refresh and reason again. Do not replay the previous
transaction blindly. On a lock conflict, preserve the human result and choose
another expression or request a decision.

### 6. Read the returned facts

Read response fields in this order:

1. operation success and error code;
2. failing edit `path` and `objectIds`;
3. returned revision and diff;
4. `resolvedRoutes` actual polylines;
5. structural diagnostics first, then visual observations with confidence and
   gate eligibility;
6. crossings and flightlines from the final committed Document.

Use [response-semantics.md](response-semantics.md) instead of rediscovering the
meaning of each field or code.

### 7. Render and inspect visually

Request a formal render after structural checks. Inspect the whole
page and then dense local regions. Compare the visible result with the intended
functional grouping and RouteGraph, not only with counters.

At minimum inspect:

- signal flow and functional grouping;
- terminal departures and shared-node expression;
- real Junction dots versus dot-free bends/crossings;
- short bumps, hooks, boxes, duplicate nearby Junctions, and wire reversals;
- instance and Net label placement;
- repeated-unit rhythm, whitespace, and hierarchy boundaries.

Zero structural issues, observations, crossings, or flightlines does not prove readability.
If the image is confusing, revise the Agent's placement or graph even when all
implemented diagnostics pass.

### 8. Close deterministically

Refresh the Snapshot and verify:

- connected pins and Net terminals still agree;
- all intended visible endpoints are represented;
- no unintended flightline, ambiguous Junction, or unresolved symbol remains;
- every visual observation was checked against the formal render rather than
  mechanically cleared;
- formal artifacts came from the final committed revision.

State intentional warnings and remaining uncertainty with object IDs. Do not
claim electrical correctness without the required simulator, models, analyses,
corners, and acceptance criteria.

## Stop instead of guessing

Stop and report the missing fact when pin order, bulk mapping, model semantics,
hierarchy binding, lock ownership, or the user's requested topology change is
ambiguous. Visual uncertainty may be iterated; electrical uncertainty must not
be resolved by drawing convention.
