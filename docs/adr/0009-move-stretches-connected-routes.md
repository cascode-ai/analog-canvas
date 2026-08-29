# ADR 0009: Movement preserves connected Route topology

Status: `accepted`

Date: `2026-08-07`

Owners: `packages/edit-engine`, `packages/derived`

## Context

Moving an Instance or Junction changes resolved endpoint geometry. Leaving its
incident Routes untouched either produces invalid geometry or makes ordinary
placement refinement disconnect a circuit visually. GUI-only follow behavior
would also diverge from Agent and transaction semantics.

## Decision

Movement is evaluated as one routing operation plan. The Edit Engine proposes
topology-preserving changes for incident Routes and validates the resulting
electrical effects before commit. Explicit Route edits in the same transaction
remain the geometry authority for those Routes; protected Route semantics are
not silently overridden.

Single-object, group, Junction, rotate, mirror, and direct-contact lifecycle
operations share the same planning boundary. A direct contact that separates
while connectivity is meant to remain becomes visible Route geometry; an
explicit cut is the operation that changes physical connectivity.

The follow operation is local. It preserves stable Route leg and Junction
identity where possible and does not invoke a global router or promise a
visually optimal result.

## Consequences

- Human and Agent movement use the same atomic connectivity behavior.
- Placement can be refined without silently disconnecting established Nets.
- Locked or explicitly edited geometry remains deliberate rather than being
  rewritten by a hidden follow pass.
- Callers still inspect the resulting geometry and may perform a later routing
  refinement.

## Validation

- Edit Engine coverage exercises individual and group transforms, explicit
  Route edits, protected geometry, direct contacts, Undo, and Redo.
- Routing-operation tests prove that the evaluated plan and committed
  electrical effects agree.

## Related documents

- [`0014-resolved-route-geometry.md`](0014-resolved-route-geometry.md)
- [`0041-physical-cut-and-endpoint-readiness.md`](0041-physical-cut-and-endpoint-readiness.md)
- [`0047-stable-route-leg-model.md`](0047-stable-route-leg-model.md)
- [`0048-routing-operation-plan.md`](0048-routing-operation-plan.md)
- [`../specs/edit-engine.md`](../specs/edit-engine.md)
