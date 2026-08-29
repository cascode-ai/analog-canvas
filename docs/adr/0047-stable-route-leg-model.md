# 0047 - Stable Route leg and bend identity

Status: `accepted`

Date: `2026-08-27`

Owners: `packages/model`, `packages/project-protocol`, `packages/derived`,
`packages/edit-engine`, `packages/render-svg`, `packages/agent-adapter`,
`apps/editor`

## Context

Schema 25 stores a Route as two endpoints plus parallel `waypoints[]` and
`segmentModes[]` arrays. A geometric segment has no stable identity: its
address is its current array index. Removing a zero-length segment, merging
collinear segments, splitting a Route, or transforming an endpoint can change
both arrays and every later segment index. That has caused invalid transactions
when geometry and modes were normalized at different times, and makes a
persisted label or measurement attachment silently point at a different
segment after an otherwise local edit.

The electrical model around a Route is already sound. Terminals are symbolic
pin references, Junctions are explicit shared topology nodes, crossing is not
connectivity, and several Route branches joined by Junctions form the visible
graph of one Net. Replacing those rules with a second whole-Net graph would add
more state without solving the unstable-segment problem.

## Decision

Schema 26 represents each Route branch as one start endpoint followed by one or
more ordered legs. Every leg owns its segment mode and a stable `legId`. An
internal leg ends at a bend containing a stable `bendId` and position; the last
leg ends at the existing terminal-or-Junction endpoint type.

```ts
interface RouteBranch {
  id: StableId;
  netId: StableId;
  start: RouteEndpoint;
  legs: [RouteLeg, ...RouteLeg[]];
  presentation?: RoutePresentation;
}

interface RouteLeg {
  id: StableId;
  to:
    | { kind: "bend"; bendId: StableId; position: Point }
    | { kind: "endpoint"; endpoint: RouteEndpoint };
  mode: SegmentMode;
}
```

The final leg must target an endpoint; every preceding leg must target a bend.
The existing endpoint, Junction, Net, crossing, direct-contact, Route
presentation, and arbitrary-angle geometry contracts do not change. A Route
remains an unbranched path. Branching remains explicit through Junctions.

Persisted Route attachments address `{ routeId, legId }`. Derived geometry may
also expose a revision-scoped `segmentIndex` for ordered traversal and hit
testing, but that index is never persistent identity.

All mutations return or internally apply an explicit identity remap. The
following normalization rules are canonical:

- an unchanged leg or bend retains its ID;
- splitting a leg retains the original leg ID on the start-side leg and gives
  the inserted continuation a fresh ID;
- a newly inserted bend receives a fresh bend ID;
- merging adjacent collinear legs retains the start-side leg ID and records
  the removed leg and bend in the remap;
- deleting a zero-length leg uses the same start-side retention rule when a
  neighbour exists and otherwise deletes the Route;
- reversing a path preserves the physical leg and bend IDs while reversing
  their order and endpoints;
- copying always allocates fresh Route, leg, and bend IDs;
- undo and redo restore the exact IDs captured by the committed transaction.

The strict Route replacement edit is renamed from the array-shaped
`set_route_points` contract to a leg-aware `set_route_path` contract. GUI,
shortcut, importer, generator, and Agent callers continue to submit typed
edits through the Edit Engine; none receives a second mutation protocol.

## Alternatives considered

### Keep parallel arrays and strengthen length validation

- Benefits: smallest schema change.
- Costs: segment identity remains positional and every normalizer must still
  keep two arrays synchronized.
- Reason not selected: it prevents some invalid writes but does not make edits,
  attachments, split, merge, undo, or copy robust.

### Persist a whole-Net node/edge graph

- Benefits: can represent branches inside one aggregate object.
- Costs: duplicates existing Route/Junction topology and makes local editing,
  ownership, serialization, and migration substantially broader.
- Reason not selected: current electrical topology is correct; only the path's
  segment representation and identity are deficient.

### Add a dangling endpoint in the same migration

- Benefits: isolated Wire endpoints would no longer use route-anchor
  Junctions.
- Costs: changes Junction lifecycle and selection/delete semantics in the same
  shared-contract cut.
- Reason not selected: it is an independent decision and is deferred until the
  stable leg model supplies evidence that it is needed.

### Keep `segmentIndex` attachments and remap heuristically

- Benefits: fewer immediate consumer changes.
- Costs: an attachment can silently bind to a different physical segment after
  normalization.
- Reason not selected: persistent identity must survive local geometry edits.

## Consequences

### Positive

- segment mode cannot become out of sync with segment geometry;
- attachments survive unrelated insertions and removals earlier in a Route;
- split, merge, transform, copy, delete, and undo can state deterministic
  identity behavior;
- later routing-operation planners can address one leg without reintroducing a
  positional protocol;
- all consumers share one canonical persisted representation.

### Negative or limiting

- schema 26 is a broad clean cut across model, protocol, derived geometry,
  engine, editor, renderer, fixtures, import/export, and Agent snapshots;
- stable IDs increase serialized Route size;
- normalization must return identity remaps instead of only new coordinates;
- this decision does not itself improve routing aesthetics, reroute around
  obstacles, change Snap, or add richer loose-end semantics.

## Compatibility and migration

The schema-25-to-26 migration is deterministic. `from` becomes `start`; every
waypoint creates one bend-target leg; `to` becomes the final endpoint-target
leg; the mode at each old segment index becomes that leg's mode. Route IDs are
preserved. Leg and bend IDs are derived deterministically from the Route ID and
old order so repeated migration produces byte-stable identity. A persisted
attachment at `segmentIndex: i` is rewritten to the generated leg ID for index
`i`.

Project Protocol keeps its rolling current-and-previous reader policy, so the
default schema-26 reader accepts schema 25 and 26. Schema 24 leaves the default
window; widening that policy requires a separate decision. Writers emit only
schema 26. Runtime code does not retain a schema-25 Route facade or write both
representations.

The migration must preserve electrical topology hash, resolved centerline,
leg mode order, rendered Junction/crossing behavior, and attachment position.
Schema 25 fixtures remain migration inputs; runtime and generated fixtures are
updated to schema 26.

## Validation

- characterization fixtures compare schema-25 serialization, topology hash,
  resolved centerline, mode order, attachment placement, and Junction output;
- migration tests prove deterministic IDs, attachment remapping, idempotent
  reading, and schema-25-to-26 visual/electrical equivalence;
- focused derived and Edit Engine tests cover zero-length removal, collinear
  merge, split, reverse, transform, copy, delete, and undo/redo identity;
- affected workspace gates cover editor gestures, Project save/reopen,
  renderer output, netlist import/export, and Agent snapshot/edit artifacts.

## Related documents

- [ADR 0039](0039-any-angle-route-authoring.md)
- [ADR 0041](0041-physical-cut-and-endpoint-readiness.md)
- Local execution plan:
  `plan/2026-08-27-routing-net-operation-foundation/plan.md`
