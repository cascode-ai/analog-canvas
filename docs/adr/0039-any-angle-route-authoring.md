# 0039 - One Route protocol with any-angle authoring

Status: `accepted`

Date: `2026-08-22`

Owners: `packages/model`, `packages/derived`, `packages/edit-engine`,
`apps/editor`

## Context

Route heading is geometry, not topology. Separate orthogonal, diagonal, and
free-angle persisted Route types would make connectivity, Junction, selection,
rendering, and editing disagree about the same conductor.

## Decision

There is exactly one persisted Route/Net/Junction protocol. The shared segment
geometry kernel owns projection, containment, intersection, collinearity, and
direction for every non-zero segment. Segment heading is not a Project-validity
rule.

`orthogonal`, `octilinear`, and `free` are transient authoring constraints.
Orthogonal remains the default; octilinear admits horizontal, vertical, and
±45-degree segments; free reaches the authored point directly. Switching a
constraint affects only the unresolved Wire leg, and Backspace removes the
latest authored step. Existing committed geometry is not silently normalized.

Direct manipulation rejects only degenerate ordinary Route geometry. A
`power-rail` remains the deliberate exception: one non-zero, axis-aligned
straight segment. A Crossing remains disconnected without an explicit
Junction. `bulk-dashed` remains ordinary Route geometry with its own
presentation.

The Agent-local RouteGraph helper may enforce a stricter octilinear input
contract without changing the persisted model or the interactive editor.

## Amendment — 2026-08-30 same-Net conductor canonicalization

"Existing committed geometry is not silently normalized" keeps its original
meaning: switching a transient authoring constraint never reformats committed
centerlines, and no pass rewrites the visible shape of a conductor.
Commit-time same-Net conductor-topology canonicalization, introduced with the
conductor-topology normalization change (2026-08-30), is a deliberate,
specified exception at the structure level: on the Nets a transaction
touched, the Edit Engine may union duplicate collinear coverage, materialize
true branch vertices, and remove unowned degree-two Junctions (collinear
branch joins and route-anchor joins alike), preserving the resolved
centerline point set and electrical membership exactly. The visible drawing and the Net are unchanged; only the partition of
that drawing into Route objects is canonical. The rule and its exclusions are
normative in
[connectivity and routing](../specs/connectivity-and-routing.md).

## Consequences

- Every authoring mode uses the same connectivity and render consumers.
- Arbitrary-angle Routes can be selected, split, labeled, crossed, and moved
  without a compatibility shape.
- Visual regularity remains an authoring choice rather than a write-time
  electrical constraint.

## Validation

- Edit Engine tests accept non-zero arbitrary-angle ordinary Routes and reject
  degenerate geometry.
- Power-rail tests retain the straight axis-aligned invariant.
- Browser tests cover Wire mode switching and authored-step undo.

## Related documents

- [ADR 0008](0008-agent-local-route-tree-expander.md)
- [ADR 0014](0014-resolved-route-geometry.md)
- [ADR 0014](0014-resolved-route-geometry.md)
- [connectivity and routing spec](../specs/connectivity-and-routing.md)
- [editor interaction spec](../specs/editor-interaction.md)
