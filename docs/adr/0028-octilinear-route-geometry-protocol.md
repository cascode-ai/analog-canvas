# 0028 - One Route Geometry Protocol with Octilinear Authoring

Status: `accepted` (authoring clause superseded by [ADR 0039](0039-any-angle-route-authoring.md))

Date: `2026-08-20`

Owners: `derived geometry, edit engine, editor, Agent API`

## Context

The persisted `Route` already stores a generic polyline, but write validation
and several read consumers independently assumed horizontal/vertical segments.
Adding a diagonal Route type would split connectivity, Junction, selection,
and rendering behavior just as users need those behaviors to agree.

## Decision

There remains exactly one persisted Route/Net/Junction protocol. Segment
heading is geometry, not topology or a Route variant. The derived
segment-geometry kernel owns projection, containment, intersection, collinear
normalization, and unit direction. The edit engine owns transient authoring
constraints: `orthogonal` remains the default and `octilinear` permits H, V,
and ±45° headings. The kernel itself is generic enough for a future explicitly
approved arbitrary-angle policy.

Wire stores authored draft steps plus the active transient policy. Each step is
compiled deterministically into ordinary Route waypoints. MMB click switches
the unresolved Wire leg between orthogonal and octilinear; MMB drag continues
to pan. F3 exposes Wire options. Fixed legs never change when policy changes,
and Backspace removes one authored step.

`bulk-dashed` uses the same policy and Route transaction. `power-rail` remains
horizontal-only. Crossings remain disconnected absent an explicit Junction.

## Consequences

### Positive

- GUI, Agent, renderer, hit testing and connectivity reason about one model.
- 45° wire can tap, split, select, label, and cross under the existing rules.
- Orthogonal documents and default output remain stable.

### Negative or limiting

- Arbitrary-angle authoring is intentionally not exposed yet. ADR 0039 later
  granted the explicitly approved arbitrary-angle policy this anticipated.
- Existing route editing must infer its allowed geometry from the Route rather
  than silently rerouting a diagonal path as orthogonal.

## Compatibility and migration

The persisted Route shape is unchanged. A client that cannot edit octilinear
geometry must not advertise the octilinear command capability. Project-version
advancement is only required when rolling-client deployment makes this command
capability boundary insufficient.

## Validation

- orthogonal planner parity;
- octilinear compile, route tap, Junction split, crossing and terminal miter;
- Wire reducer mode transitions and authored-step undo;
- transaction rejection of non-octilinear ordinary routes and non-horizontal
  power rails.

## Related documents

- [ADR 0009](0009-move-stretches-connected-routes.md)
- [ADR 0014](0014-resolved-route-geometry.md)
- [connectivity and routing spec](../specs/connectivity-and-routing.md)
- [editor interaction spec](../specs/editor-interaction.md)
