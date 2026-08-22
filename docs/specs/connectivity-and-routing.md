# Connectivity and Routing

Status: `accepted`

Primary owners: `packages/model`, `packages/edit-engine`, `packages/derived`

`Net.terminals` is logical connectivity. A terminal is an Instance pin; both
`port` and `port-filled` participate through their ordinary pin `P`. Routes use
the same terminal endpoint for those Instances and every other component.

A Route belongs to one Net and connects terminal or Junction endpoints. Its
editable centerline is endpoint, zero or more waypoints, endpoint;
`segmentModes.length` is always `waypoints.length + 1`. Junctions are explicit
branch/route anchors. Geometric crossing or overlap does not create electrical
contact.

Route centerlines are one geometry protocol. Normal interactive Routes may use
horizontal, vertical, or ±45-degree segments; orthogonal is the default
authoring constraint, not a second persisted Route shape. `power-rail` is the
single exception: it is one straight, non-zero horizontal or vertical segment.
A future arbitrary-angle policy must use the same segment-geometry kernel and
Route transaction.

## Authoring rules

- Starting and ending a wire on terminals or explicit Junctions creates or
  joins real Net membership through one atomic Edit Engine transaction.
- A Route-segment tap splits geometry at an explicit Junction. A mere crossing
  remains disconnected.
- Moving a connected Instance stretches the attached Route while preserving
  endpoint identity.
- Deleting geometry does not silently invent an alternate connection.
- `NoConnect` and Net membership are mutually exclusive.
- Snap, selection, highlight, clipboard, undo, Agent Snapshot, and formal render
  consume the same resolved endpoint geometry.

Routes may present as `wire`, `bulk-dashed`, or `power-rail`; presentation does
not alter Net identity. `bulk-dashed` is used for explicit MOS B routing.
Manual MOS instances without explicit B membership first use a configured
cell-default Net; without one, bulk remains unresolved. Starting a
`bulk-dashed` route from B treats a configured default membership as unowned;
committing clears the binding before connecting the explicit Net. Deleting the
explicit route may reconcile only an explicitly configured cell default.
Source-bound/imported MOS instances remain governed by their fourth-node
evidence and are never guessed. Legacy persisted `supply-default` bindings are
readable compatibility data, not a current authoring policy.

A `power-rail` Route is valid only on an explicit named Net whose persisted
`powerDomain` is `vdd`. Rail authoring creates or reuses that name in the
current Document, preserves an existing explicit scope, and otherwise creates
a local Net. It adds two route-anchor Junctions, the rail Route, and one
net-name-bound RichText power label. It creates no VDD Instance. Branch wires
on the same Net use ordinary wire presentation and explicit contact evidence.
The two rail endpoints remain directly resizable along the rail axis; moving
the rail translates its full connected component, including tap Junctions,
without splitting the rail into independent pieces.

A named global Net is itself an explicit semantic bridge. Separate Ground or
VDD markers on that Net do not require a drawn trunk or matching label and do
not produce a flightline. Named local Nets still require route, contact, or
label evidence for their visible connectivity.

## Imported routing guidance

SPICE import creates electrical membership before drawing. Only a Net whose
persisted `origin.kind` is `spice-import` is eligible for derived routing
guidance. `deriveRoutingGuidance` is a pure, device-neutral minimum-spanning
tree over current visible components supplied by the connectivity adapter: it
does not read symbols, MOS/Bulk semantics, SPICE records, labels, or editor
state. Symbol pin visibility, implicit terminals, and named-global-Net
exemptions are adapter policy before this calculation.

A guide is transient presentation, never a Route, Junction, or electrical
contact. A guide click starts the ordinary Wire interaction. Label, geometry,
or transform edits cannot dismiss guidance; the current graph simply yields a
new result. `remove_route_geometry` retains Net membership and therefore
re-exposes unresolved imported components. A normal connection cut may split
an authored local Net but must retain imported membership. The editor may show
focused, all, or hidden imported guides; Net highlight suppresses only the
highlighted Net's guides. Unplaced endpoints remain in the Placement Tray and
do not receive invented page coordinates.

## Derived read models

`ProjectConnectivityIndex` is the shared logical/routed connectivity view.
`ResolvedRouteGeometry` is the shared geometry for render, hit testing, drag,
marker attachment, diagnostics, export, and Agent Snapshot.
`deriveDocumentContactEvidence` is the sole coincident-endpoint contact source;
consumers do not infer contact independently from pixels or bounds.

Route queries (tap, nearest segment, crossings) and attachment placement are
read-only derived modules. Route normalization, constraint-aware authoring, segment
movement, stretch, and the `RouteEditPlan` preview/commit boundary belong to
`@icm/edit-engine`; no compatibility `RoutePolyline` protocol exists.

For explicit same-Net endpoints at the same page coordinate, contact evidence
records terminals/Junctions, independently authored Route arms, and incident
directions. Route waypoints are not implicit contacts. A visible dot represents
authored branch topology, not line intersection: Route arms and terminal stems
count by distinct visible direction, so collinear incidents paint as one
conductor and do not justify a dot. Three distinct visible directions require a
dot; three or more coincident terminals also require one even when some stems
overlap.

## Transaction invariants

- Every terminal and Junction reference exists.
- Every Route endpoint agrees with the Route Net.
- A terminal belongs to at most one Net.
- Route normalization removes duplicate and collinear interior points without
  changing endpoint identity.
- A failed multi-edit transaction changes nothing; a successful one advances
  revision once.
- GUI and Agent use the same planners, transaction engine, derived geometry,
  and diagnostics.
