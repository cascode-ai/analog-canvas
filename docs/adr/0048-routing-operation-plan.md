# 0048 - One evaluated plan for routing operations

Status: `accepted`

Date: `2026-08-27`

Owners: `packages/derived`, `packages/edit-engine`, `apps/editor`

## Context

Routing-related gestures previously wrapped specialist edits in a
`ConnectivityProposal`. That envelope copied changed IDs into separate logical
and geometry summaries, accepted an untyped `preview`, and only checked the
Document revision before returning the edits. Preview code and the real
transaction could therefore disagree, while a planner's claimed electrical
effect was never checked from the resulting Document.

The typed edit transaction remains the only mutation protocol. A second list
of Route or Net changes would duplicate it and become another source of truth.

## Decision

Every routing operation is represented by one transient
`RoutingOperationPlan`. It records the source Document revision, a bounded
intent, the affected closure, the expected electrical effect, typed edits,
stable identity remaps, and diagnostics. It contains no generic preview field
and is never persisted or exposed as a new Project schema layer.

`evaluateRoutingOperationPlan()` executes the real edit transaction without
committing it, derives electrical projections independently before and after,
and rejects an actual effect that exceeds the declared effect. Its resulting
Document is the authoritative preview. A UI commit submits the same evaluated
edits and preallocated IDs; it does not ask a gesture-specific preview helper
to reconstruct the mutation.

The electrical projection includes endpoint-to-Base-Net membership, physical
Route/contact components, Logical-Net membership, owner-addressed name claims,
Route incidence, and Junction incidence. It is derived from the Documents, not
from a planner's affected-object list.

The operation intent vocabulary is limited to connect, attach-to-route, cut,
transform, route-geometry, clone, delete, rename-marker, and rename-net.
NoConnect and unrelated presentation or drafting edits continue to use the
ordinary typed transaction directly.

## Consequences

### Movement preserves established connectivity

Instance, group, Junction, rotate, mirror, and direct-contact transforms share
this planning boundary. Incident Routes follow changed endpoints locally;
explicit Route edits in the same transaction remain geometry authority for
those Routes. Protected geometry is not silently overridden.

A direct contact that separates while connection is preserved becomes visible
Route geometry. Moving its participants together retains direct contact without
inventing a Wire. Explicit cut changes physical connectivity. Stable leg and
Junction identities are retained where possible; the follow pass is not a
global router and promises no globally optimal layout.

Tests cover individual/group transforms, explicit Route overrides, protected
geometry, direct contacts, undo/redo, and equality between previewed and committed
electrical effects. The full rules are in the
[connectivity specification](../specs/connectivity-and-routing.md).

### Shared operation boundary

- `ConnectivityProposal` and its `preview?: unknown` escape hatch are removed;
- specialist planners still own domain decisions, but return edits to one
  common evaluation boundary;
- source revision changes reject the plan rather than silently recalculating
  it at click time;
- connect, cut, transform, clone, graph delete, marker rename, and whole-Net
  rename all declare and validate their bounded electrical effect;
- the command router, shortcuts, pointer gestures, and visible UI do not
  change.

## Rejected alternatives

- Keeping `ConnectivityProposal` beside a new operation plan would preserve
  two orchestration protocols.
- Persisting the plan would duplicate Project facts and make history depend on
  transient UI state.
- Trusting planner-provided changed IDs would not detect an unintended Net
  merge, split, or owner rebind in the final transaction result.
