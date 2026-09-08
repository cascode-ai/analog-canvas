# ADR 0014: Stable Route legs and resolved geometry

Status: `accepted`

Date: `2026-08-12`

Owners: `packages/model`, `packages/derived`, `packages/edit-engine`,
`packages/render-svg`, editor and export consumers

## Context

Rendering, hit testing, dragging, attachment placement, diagnostics, and export
must see the same Wire. Earlier consumers independently reconstructed Route
polylines and seam bridges, while positional segment indices changed whenever a
bend was inserted or normalized.

## Decision

A persisted Route is an ordered chain of stable legs. Each leg has a stable ID;
authored bends have stable bend IDs; endpoints refer to real electrical or
Junction targets. Structural Route edits preserve surviving identities and
explicitly remap or retire affected identities.

`packages/derived` resolves those facts into one non-persisted
`ResolvedRouteGeometry` containing the centerline, leg-addressed segments,
vertices, and terminal/Junction join recipes. Rendering, hit testing, segment
dragging, annotations, routing diagnostics, and formal export consume that
geometry rather than reconstructing their own path.

The centerline ends at true endpoint origins. Join recipes close terminal and
retained degree-two Junction seams without inventing electrical topology or
persisted escape points. Stroke width, hit tolerance, and viewport bounds
remain presentation concerns. A positional array index may be used while
evaluating one revision, but is never a durable segment identity or persisted
attachment address.

The resolver is pure. Only the Edit Engine mutates Route facts, and preview and
commit are derived from the same edit plan.

## Authoring constraints and canonicalization

There is one Route protocol for every non-zero heading. Projection,
containment, intersection, collinearity, and direction use the same geometry
kernel. `orthogonal`, `octilinear`, and `free` are transient authoring
constraints, not different persisted electrical types. Orthogonal is the
default; octilinear admits horizontal, vertical, and ±45-degree legs; free
reaches the authored point directly. Switching mode affects the unresolved
leg, not committed geometry; Backspace removes the latest authored step.

A `power-rail` remains one non-zero axis-aligned segment. `bulk-dashed`
changes ordinary Route presentation, not topology. The Agent-local RouteGraph
helper may impose stricter octilinear input without constraining the Project.

Commit-time normalization may union duplicate same-Net collinear coverage,
materialize true branches, and remove unowned degree-two Junctions on touched
Nets. It preserves the resolved centerline point set and electrical membership,
while reconciling stable identities and attachments. It is not a silent
reformat of the drawing when an authoring mode changes. Protected geometry and
other exclusions follow the connectivity specification.

## Consequences

- Every consumer agrees on Wire geometry and direct-pin/Junction continuity.
- Route attachments survive unrelated edits through stable leg identity.
- Visual seam repair cannot silently alter connectivity.
- A structural edit that destroys a leg must deliberately reconcile its
  attachments.

## Related documents

- [`0013-project-connectivity-index.md`](0013-project-connectivity-index.md)
- [`0048-routing-operation-plan.md`](0048-routing-operation-plan.md)
- [`../specs/connectivity-and-routing.md`](../specs/connectivity-and-routing.md)
- [`../specs/export.md`](../specs/export.md)
