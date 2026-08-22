# 0039 - Any-Angle Route Authoring

Status: `accepted`

Date: `2026-08-22`

Owners: `derived geometry, edit engine, editor, Agent API`

## Context

[ADR 0028](0028-octilinear-route-geometry-protocol.md) established one Route
geometry protocol and made segment heading geometry rather than topology. It
recorded that the derived segment-geometry kernel "is generic enough for a
future explicitly approved arbitrary-angle policy", and listed
"arbitrary-angle authoring is intentionally not exposed yet" as its one
limiting consequence.

The repository owner has now asked for arbitrary-angle wires, stating that the
octilinear restriction is too limiting and that write validation should not
enforce it. This ADR is that explicit approval.

## Decision

Segment heading is not a validity rule. Write validation accepts any Route
whose segments are non-zero; `orthogonal`, `octilinear`, and the new `free`
mode remain transient authoring policies chosen per command, exactly as ADR
0028 framed them.

`WireRoutingMode` gains `free`, which compiles an authored click to the
straight line that reaches it. The middle-click corner cycle ends on it, so
any angle is reachable without opening the Wire options.

Direct manipulation follows: a segment drag and an endpoint move reject only
degenerate geometry. The tidying elbow that an endpoint move inserts stays
limited to legs that were already octilinear, so a diagonal is stretched
rather than given a corner.

Unchanged: `power-rail` remains one straight axis-aligned run, a Crossing is
still not a Junction, and `@icm/agent-routing` keeps the stricter octilinear
contract ADR 0008 gives that Agent-side helper — it snaps and validates what
an Agent supplies and is not the model's invariant.

## Consequences

### Positive

- A wire can land at whatever angle reaches its endpoint.
- The geometry kernel needed no change: projection, containment,
  intersection, collinearity, and unit direction were already angle-agnostic,
  so crossing detection, hit testing, and rendering follow for free.

### Negative or limiting

- Orthogonal drawings remain the default, so a document's look is now a
  function of authoring discipline rather than of validation.
- A free-angle Route cannot be expressed through the Agent RouteGraph helper
  until ADR 0008's contract is revisited.

## Compatibility and migration

The persisted Route shape is unchanged and every existing document stays
valid: this widens what validation accepts and never rewrites geometry. No
Project-version advancement is required.

## Validation

- transaction acceptance of an arbitrary-angle ordinary Route, and continued
  rejection of a degenerate one;
- continued rejection of a non-straight `power-rail`;
- wire compilation for `free`, and the middle-click corner cycle reaching it.

## Related documents

- [ADR 0028](0028-octilinear-route-geometry-protocol.md) — superseded on its
  authoring clause only
- [ADR 0008](0008-agent-local-route-tree-expander.md)
- [connectivity and routing spec](../specs/connectivity-and-routing.md)
- [editor interaction spec](../specs/editor-interaction.md)
