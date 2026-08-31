# Connectivity and Routing

Status: `accepted`

Primary owners: `packages/model`, `packages/edit-engine`, `packages/derived`

`Net.terminals` is logical connectivity. A terminal is an Instance pin; both
`port` and `port-filled` participate through their ordinary pin `P`. Routes use
the same terminal endpoint for those Instances and every other component.

A Route belongs to one Net and connects terminal or Junction endpoints. Its
canonical path is one `start` endpoint followed by ordered legs. Non-final
legs end at stable, dot-free bends; the final leg ends at the other endpoint.
Each leg owns its mode and stable `legId`, so geometry and behavior cannot
drift as parallel arrays. Junctions are explicit branch/route anchors. A
perpendicular geometric crossing does not create electrical contact by itself.
Collinear same-Net overlap is never canonical persisted geometry: the Edit
Engine unions the covered conductor, materializes true branch vertices, and
removes redundant degree-two Junctions — an unowned collinear branch join
disappears, and a degree-two route-anchor is no longer a loose end, so its
two arms coalesce into one Route whether they continue straight or fold into
an interior bend. An explicit cross-Net Wire
connection merges compatible Base Nets before the same normalization; passive
transforms never silently merge different Nets. Power-rail, MOS bulk, and
locked presentations retain their own authored geometry and do not participate
in ordinary-Wire coverage union. When differently colored ordinary Routes
overlap, the Route contributing the most coverage to a normalized path owns
its style; stable Route identity breaks a tie.

Opening a portable Project file runs the same normalization over an imported
copy so legacy overlap is repaired immediately and the result is marked dirty
for an explicit Cloud Save or Project export. Cloud opens, recovery, and the
project-protocol parser remain exact: they never rewrite stored geometry as a
read side effect.

Route centerlines are one geometry protocol. Normal interactive Routes may use
horizontal, vertical, or ±45-degree segments; orthogonal is the default
authoring constraint, not a second persisted Route shape. `power-rail` is the
single exception: it is one straight, non-zero horizontal or vertical segment.
A future arbitrary-angle policy must use the same segment-geometry kernel and
Route transaction.

## Authoring rules

- Starting and ending a wire on terminals or explicit Junctions creates or
  joins real Net membership through one atomic Edit Engine transaction.
- Every terminal resolves through one `EndpointConnection`. Exact artwork
  contact and outward escape are derived presentation geometry; the Wire
  compiler persists only grid landings and ordinary grid bends. An offset
  MOS B anchor therefore uses the same Route transaction as every other pin;
  `bulk-dashed` changes only presentation.
- Exact visible endpoint coincidence is a zero-length physical contact, but
  only geometry a transaction INTRODUCES bonds. When a newly placed Instance,
  an explicit Junction, a drawn power rail, or a typed attach reaches its
  final coordinates, the Edit Engine deterministically creates or merges the
  participating Base Net; incompatible power domains or Net-name contracts
  reject the whole transaction. Moving, rotating, mirroring, aligning, or
  re-pointing EXISTING geometry never bonds: a transform that parks endpoints
  on foreign conductors leaves them visually coincident but electrically
  separate, exactly like a Crossing — rearranging a schematic can neither
  silently merge Nets nor be rejected by a merge it never asked for. An
  explicit `disconnect_endpoint` in the same transaction suppresses
  normalization so deletion cannot immediately reconnect itself.
- If a move, rotation, or mirror separates a confirmed direct contact, the
  transaction materializes one ordinary manual Route after all transforms have
  reached their final positions. Jointly transformed endpoints remain a
  route-free direct contact, and an existing alternate physical path prevents
  duplicate Route creation.
- A Route-segment tap splits geometry at an explicit Junction. A newly
  authored Junction that lands on another ordinary Route joins and splits
  that conductor as well; an existing Junction carried across a conductor by
  a transform does not, and a mere route-interior crossing remains
  disconnected. Pin-to-route attachment remains a snapped typed intent
  because it changes the selected Route's identity and geometry.
- Route splitting is reversible topology, not permanent stroke history. When
  a branch is cut, an unowned degree-two collinear Junction is removed and its
  surviving arms coalesce into one Route; a Wire continued from a loose end
  extends the existing conductor the same way instead of leaving two pieces
  joined by an invisible anchor. Route labels, markers, layout references, and
  stable leg ownership follow the normalized conductor.
- Placing a component with one eligible pair of exact pin contacts on one
  continuous ordinary Route performs one atomic series splice: the two
  contacts split the conductor, the between-pin span is removed, and the Base
  Net partitions so the two pins cannot remain shorted. Every visible
  two-terminal device is eligible; a multi-pin device must declare its stable
  series-insertion pair in the Device descriptor (D/S for MOS, C/E for BJT),
  so symbol bounds and incidental pin proximity never decide electrical
  topology. One contacted pin remains an ordinary endpoint-to-Route
  attachment; power rails, MOS bulk leads, locked geometry, and undeclared or
  ambiguous multi-pin pairs never cut the conductor. Their exact contacts may
  still use ordinary attachment semantics; visual overlap alone does nothing.
- Moving a connected Instance stretches the attached Route while preserving
  endpoint identity.
- `remove_route_geometry` removes presentation geometry only. The ordinary
  Wire Delete command uses `cut_connection`: it always recomputes physical
  Base-Net components and never lets imported, global, or name Evidence hide a
  real disconnection.
- A Route-anchored label or marker is part of the Route deletion closure and is
  removed through its typed annotation edit before the Route is cut.
- Transform, `C` copy-placement, graph deletion, marker rename, and whole-Net
  rename first compile one transient `RoutingOperationPlan`. The plan carries
  a stable-ID affected closure, expected electrical effect, typed edits and ID
  remap; an independent before/after projection validates the effect before
  the same edits commit. It is not Project data or an Agent protocol.
- Transform classifies selected conductors once: internal Routes move rigidly,
  boundary Routes stretch only at the inside endpoint, and external Routes do
  not move. Unsafe protected geometry rejects atomically; no transform invokes
  rerouting.
- `C` clones the selected internal electrical subgraph. Ordinary boundary
  Routes and terminal membership are not copied, so copied boundary pins are
  open. A selected Cell Pin, supply marker, or Net-label owner retains its own
  naming evidence and rejoins a Logical Net only through `name + scope`.
  Imported `net-name-hint` and `spice-source` provenance may travel with a
  copied Base Net but never rejoins it by source spelling or source identity.
  Implicit MOS bulk binding remains the explicit Cell-policy exception.
- Delete is one graph operation: selected Route geometry dominates incidental
  marquee Junction dots; Junction-only deletion owns its incident arms; Route
  attachments, orphan anchors, layout references and unreferenced local Nets
  are cleaned in the same transaction.
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
readable compatibility data, not a current authoring policy. Cross-Document
composition materializes an effective source `cell-default` as an
`instance-override`: the copied B membership remains fixed to its copied Base
Net and neither consumes nor changes the target Document's Cell default.

A `power-rail` Route is valid only on a Base Net with an explicit persisted
name claim whose `powerDomain` is `vdd`. Rail authoring creates or reuses that
name in the current Document, preserves an existing explicit scope, and
otherwise creates a local Net. It adds two route-anchor Junctions, the rail
Route, and one net-name-bound RichText power label. It creates no VDD Instance.
Branch wires on the same Net use ordinary wire presentation and explicit
contact evidence.
The two rail endpoints remain directly resizable along the rail axis; moving
the rail translates its full connected component, including tap Junctions,
without splitting the rail into independent pieces.
Deleting any rail segment or its owned power label likewise removes the whole
visually continuous rail component and that label/name-owner closure in one
transaction. Ordinary tapped wires remain; a partial rail cut that would
strand an unnamed `power-rail` Route is not an authoring operation.

A named global Net is itself an explicit semantic bridge. Separate Ground or
VDD markers on that Net do not require a drawn trunk or matching label and do
not produce a flightline. Named local Nets still require route, contact, or
label evidence for their visible connectivity.

## Imported routing guidance

SPICE import creates electrical membership before drawing and persists one
`spice-source` provenance record per imported Base Net. Source provenance is
not an electrical equivalence rule. When a cut partitions that Base Net, every
surviving component retains the same source identity while remaining a
separate electrical Base Net. `deriveRoutingGuidance` is a pure,
device-neutral minimum-spanning tree over current visible components grouped
by source identity: it does not read MOS/Bulk semantics, labels, or editor
state. Symbol pin visibility, implicit terminals, and named-global-Net
exemptions are adapter policy before this calculation.

A guide is transient presentation, never a Route, Junction, or electrical
contact. A guide click starts the ordinary Wire interaction. Label, geometry,
or transform edits cannot dismiss guidance; the current graph simply yields a
new result. `remove_route_geometry` retains Net membership and therefore
re-exposes unresolved imported components. A normal connection cut splits all
physical components, including imported and global Base Nets; only the primary
component retains an unowned imported name projection, while owner-addressed
markers follow their surviving component and source provenance is copied to
every component. The editor may show
focused, all, or hidden imported guides; each guide carries the actual Base
Net at both endpoints, so clicking it uses the ordinary Wire merge path. Net
highlight suppresses guides incident to the highlighted Net. Unplaced
endpoints remain in the Placement Tray and do not receive invented page
coordinates.

## Net naming and lifecycle

Base Nets remain physical connectivity; Logical Nets are derived from
owner-addressed `name-claim` evidence. Reusing a spelling never merges Route
geometry.

Name claims resolve by scope and folded name inside the containing Document.
Flattened Document composition copies those owner-addressed claims into the
target Document's namespace, so matching local names resolve to one Logical
Net without merging their Base-Net geometry. A composition occurrence records
source-to-target identity only in the operation plan and never participates in
Net resolution. Hierarchical Cell Instances, rather than hidden naming domains,
provide local-name isolation across Documents.

- Renaming one marker detaches only that owner from its old Base Net, creates
  or joins its requested name semantics, and rebinds its own label. Other
  markers, Ports, rails and labels keep their names and physical Nets.
- Renaming a whole Logical Net updates that Logical Net's editable owner
  claims. A matching name may join compatible logical semantics but does not
  merge Base Nets; incompatible scope or power domain rejects atomically.
- Multiple same-name Ports, supply markers and power rails are legal. `VDD`,
  `AVDD`, and `DVDD` are distinct names; `powerDomain: vdd` is a role, not a
  singleton object or reserved Net ID.
- MOS bulk defaults are explicit Cell policy and do not imply a globally
  unique VDD. Deleting the last marker or owner cannot leave a ghost Net that
  blocks later reuse of the same visible name or designator.

## Derived read models

`ProjectConnectivityIndex` is the shared logical/routed connectivity view.
`ResolvedRouteGeometry` is the shared geometry for render, hit testing, drag,
marker attachment, diagnostics, export, and Agent Snapshot. It publishes the
same resolved endpoint connections consumed by those readers; consumers do not
reconstruct terminal contacts from Symbol coordinates.
`deriveDocumentContactEvidence` is the sole read model for confirmed same-Net
coincident contacts; consumers do not infer contact independently from pixels
or bounds. The transaction connectivity normalizer is the corresponding write
boundary: it derives gained endpoint and explicit Junction-on-route contacts
from exact resolved geometry and commits them through the ordinary Base-Net and
Route mutations. The conductor-topology normalizer is the complementary write
boundary for same-Net Route coverage: readers never compensate for overlapping
persisted segments or a missing T vertex.

Route queries (tap, nearest segment, crossings) and attachment placement are
read-only derived modules. Route normalization, constraint-aware authoring, segment
movement, stretch, and the `RouteEditPlan` preview/commit boundary belong to
`@icm/edit-engine`; no compatibility `RoutePolyline` protocol exists.

For explicit same-Net endpoints at the same page coordinate, contact evidence
records terminals/Junctions, independently authored Route arms, and incident
directions. Route bends are not implicit contacts. A visible dot represents
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
- Same-Net conductor normalization unions duplicate coverage, preserves every
  true branch/contact vertex, and removes unowned degree-two Junctions —
  collinear branch joins and route-anchor joins alike.
- A failed multi-edit transaction changes nothing; a successful one advances
  revision once.
- GUI and Agent use the same planners, transaction engine, derived geometry,
  and diagnostics.
