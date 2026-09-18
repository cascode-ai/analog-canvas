# Connectivity and Routing

Status: `accepted`

Primary owners: `packages/model`, `packages/edit-engine`, `packages/derived`

`Net.terminals` records Base-Net physical membership. Logical connectivity is
resolved from that membership, owner-addressed naming, scope, and interfaces. A terminal is an Instance pin; both
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
removes redundant degree-two Junctions. An unowned ordinary-Wire Junction is
no longer a branch or loose end once only two arms remain, regardless of its
historical `branch`/`route-anchor` role: its arms coalesce into one Route,
continuing straight or folding into an interior bend. An explicit cross-Net Wire
connection merges compatible Base Nets before the same normalization; passive
geometry that does not create an endpoint contact never merges different Nets.
Power-rail, MOS bulk, and locked presentations retain their own authored
geometry and do not participate in ordinary-Wire coverage union. When
differently colored ordinary Routes overlap, the Route contributing the most
coverage to a normalized path owns its style; stable Route identity breaks a
tie.

Opening a portable Project file runs the same normalization over an imported
copy so legacy overlap is repaired immediately and the result is marked dirty
for an explicit Cloud Save or Project export. Cloud opens, recovery, and the
project-protocol parser remain exact: they never rewrite stored geometry as a
read side effect.

An ordinary Route that resolves entirely to one exact point after a built-in
terminal-anchor correction is redundant direct-contact geometry. File,
Gallery-open, and Gallery-placement import copies remove it only when both
endpoints still belong to its Base Net and no Annotation, name owner, layout
group, or constraint owns the Route. The Net membership survives unchanged;
owned geometry is retained for an explicit diagnostic instead of being
silently discarded.

Route centerlines use one geometry protocol for every non-zero heading.
Interactive `orthogonal` (default), `octilinear` (horizontal, vertical, ±45°),
and `free` modes constrain only the unresolved authored leg. They do not
reformat committed Routes. `power-rail` is the single exception: one straight,
non-zero horizontal or vertical segment. All modes use the shared segment
kernel, stable leg identity, and Route transaction.

## Authoring rules

- Starting and ending a wire on terminals or explicit Junctions creates or
  joins real Net membership through one atomic Edit Engine transaction.
- Every terminal resolves through one `EndpointConnection`. Exact artwork
  contact and outward escape are derived presentation geometry; the Wire
  compiler persists only grid landings and ordinary grid bends. An offset
  MOS B anchor therefore uses the same Route transaction as every other pin;
  `bulk-dashed` changes only presentation.
- Exact visible endpoint coincidence is a zero-length physical contact. When a
  newly placed Instance, an explicit Junction, a drawn power rail, a typed
  attach, or edited Route geometry reaches a visible endpoint, the Edit
  Engine deterministically creates or merges the participating Base Net;
  incompatible power domains or remaining name-contract conflicts reject the
  whole transaction. Ordinary Label retirement follows the naming rule below.
  For an edited Route, only visible endpoint points newly covered by the
  gesture are eligible: a pin or Junction that already rested on an unchanged
  part of the Route is not retroactively connected. Route-interior crossings
  remain electrically separate because neither conductor supplies an endpoint.
  An explicit `disconnect_endpoint` in the same transaction suppresses
  normalization so deletion cannot immediately reconnect itself, and it is read
  the same way by the expected-effect derivation, which never declares an
  endpoint the edits explicitly released as preserved.
- Releasing a wire END on a conductor bonds, whether the end arrived there by
  dragging the whole loose wire or by dragging that one endpoint handle. It is
  the same deliberate act as drawing a wire to that point, and the schematic
  the two gestures leave behind is identical, so the connectivity they record
  is identical: which handle the author happened to grab is not visible in the
  drawing and must not decide what is connected. The end joins whatever it is
  released on — a pin, another conductor's bare end, or a point part-way along
  a span, which splits that conductor at an explicit Junction. Dragging a
  segment onto a static pin or Junction likewise connects at that endpoint.
  Two conductor interiors crossing still bond nothing. When differently named
  Nets join, the planner may retire ordinary Net Labels as described below;
  supply and formal-interface names are not
  silently discarded.
  An end released over empty page is simply loose, which is a legitimate state
  and not a finding.
- A wire end anchored to a terminal is re-pointable. Dragging it detaches the
  end from its pin and lands it wherever it is released, in one transaction
  and therefore one undo; the pin leaves the Net unless another Route still
  holds it. Rewiring is an ordinary edit, and requiring the wire to be deleted
  and drawn again was not an answer.
- If a move, rotation, or mirror separates a confirmed direct contact, the
  transaction materializes one ordinary manual Route after all transforms have
  reached their final positions. Jointly transformed endpoints remain a
  route-free direct contact, and an existing alternate physical path prevents
  duplicate Route creation.
- Returning separated endpoints to their original direct contact removes the
  redundant ordinary Route geometry without removing Net membership. Route-owned
  labels, constraints and other presentation remain protected from collapse.
- A Route-segment tap splits geometry at an explicit Junction. A newly
  authored Junction that lands on another ordinary Route joins and splits
  that conductor as well. Dragging an existing Route segment onto a visible
  endpoint joins it at the exact contact point, whether the endpoint is a
  device pin or the Junction at another wire's end. The Route is split when
  needed, and the junction dot is derived from the resulting branches. A mere
  route-interior crossing remains disconnected. Pin-to-route attachment from
  the wire tool remains a snapped typed intent because it changes the selected
  Route's identity and geometry.
- Route splitting is reversible topology, not permanent stroke history. When
  a branch is cut, an unowned degree-two Junction is removed and its surviving
  arms coalesce into one Route, with an angled join retained as an interior
  bend. A Wire continued from a loose end extends the existing conductor the
  same way instead of leaving two pieces joined by an invisible anchor. Route
  labels, markers, layout references, and stable leg ownership follow the
  normalized conductor.
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
- Placement and an explicitly snapped instance move use the same engine contact
  planner. Every moved visible pin is checked against the final transformed
  geometry; multiple Net joins are folded before Route splits are compiled.
  A passive geometric move does not acquire new contacts. Already wired devices
  attach rather than silently performing a fresh series cut.
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
  not move. Boundary stretching and transaction endpoint-follow share one local
  stretch kernel. Local bends may adapt, but unrelated conductors are not rerouted.
  Unsafe protected geometry rejects atomically. Same-Net ordinary overlaps are
  normalized rather than rejected merely to preserve an old Junction dot.
- Instance drag preview carries one operation plan; ordinary geometry uses its
  lightweight projection while contact changes use the full transaction preview.
  Release strictly validates and commits that same plan against its source
  revision. Rejection or cancellation restores the original preview. A successful
  move and its contacts form one undo operation.
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
A manual MOS instance without explicit B membership resolves its body in a
fixed order: a configured cell-default Net, and failing that the supply the author
already drew — the Cell's single Net in that power domain, ground for an NMOS
body and the positive supply for a PMOS body, reported as `supply-default`.
That fallback needs no per-Cell configuration, which is what makes a pasted
copy, an imported drawing, and a drawing made before the policy existed all
behave like one drawn today. A Net is in a power domain because something
authored says so — a placed `ground` or `vdd-port` marker, or a name claim
carrying that domain (a rail, a formal Cell Pin declared as a supply). It is
never read from a Net's spelling, from device polarity, or from proximity. A Cell holding no wired
marker of that domain, or more than one (AVDD beside VDD, AGND beside DGND),
has no answer — the body stays unresolved and the Cell default must name one,
because choosing between two authored supplies is the author's decision. An
unwired marker names no Net, so it neither answers nor competes.
Pasting a supply marker settles a body default the target Cell does not have
yet, exactly as placing that marker does, and never overrules one it has. A
body left alone on a Net that its own policy binding named, with no geometry,
no name claim and no Cell terminal, is policy residue from a paste or from a
deleted marker: reconciliation returns it to the configured default.
Netlist extraction uses actual membership, including materialized defaults,
and resolves a body that policy answers but never materialized through the
same order above; `MISSING_PIN_NET` is reported for an omitted B without
explicit NoConnect only when that order has no answer.
Starting a `bulk-dashed` route from B treats a configured default membership as
unowned; committing clears the binding before connecting the explicit Net.
Deleting the explicit route may reconcile only an explicitly configured cell
default. Source-bound/imported MOS instances keep their fourth-node evidence;
when absent, the same missing-terminal rule applies. `supply-default` is a resolution status derived on
read, not authored state: nothing writes a new `supply-default` binding, and
persisted ones from an earlier release stay readable compatibility data. Cross-Document composition materializes an effective source
`cell-default` as an `instance-override`: the copied B membership remains fixed
to its copied Base Net and neither consumes nor changes the target Document's
Cell default.

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

Legacy Projects may have several supply markers sharing one inherited claim.
Before a Wire cut, each marker on the affected Base Net materializes the
unambiguous current supply name and scope as its own claim. Copy and flattened
composition capture the same owner-complete view without mutating the source.
Existing explicit marker claims and conflicting identities are never replaced.
When visible Ground owners take over node `0`, the cut retires the redundant
source-wide ground declaration: a genuinely detached unmarked terminal must
not remain grounded merely because it retains the original Base-Net ID.

File and Gallery import copies also materialize these owners. They may recover
an unnamed Ground marker on a split imported Base Net only when that Net's
source identity is backed by a surviving explicit global `0` declaration in
the Document. A bare device, arbitrary source name, conflicting current name,
or unknown supply is not recovered. The import is marked dirty and advances
the repaired Document revision once; parsing, Cloud opens and recovery remain
exact. This is a bounded legacy import repair, not a runtime source-equivalence
rule. Physical membership and authored geometry are never joined by it.

## Wire cut lifecycle

`cut_connection` requires one existing unlocked Route. Removing a bridge
partitions the affected Base Net by remaining explicit Routes and confirmed
direct contacts; global, imported, and logical-name Evidence never suppress
that physical split. A redundant cycle keeps the original Base Net.
The component containing the deleted Route's first surviving endpoint retains
the original Base-Net ID (start before end); if neither endpoint survives,
the first deterministic component is primary. Detached components receive
deterministic new IDs. Newly orphaned Junction endpoints are removed unless
still owned by annotations or layout references. Route-anchored annotations
must be removed by a preceding typed edit in the same transaction.

The [Edit Engine](edit-engine.md#operations-and-state-transitions) owns
transaction atomicity, revision and Undo. GUI deletion supplies the annotation
closure before cutting; geometry-only removal is a distinct explicit edit.

## Shared read and diagnostic boundary

[ProjectConnectivityIndex](../../packages/derived/src/connectivity-index.ts)
is a derived read model, not persisted connectivity. Document contexts are
reused by identity, revision and resolver; guidance is derived once per
Document. Project aggregation does not promise constant-time rebuilding.
Selection is not electrical input.

Search, trace and diagnostic navigation share the model's ObjectLocator and
HierarchyFrame contracts. Paths distinguish concrete callers of reused Cells;
an unresolved path never selects a guessed occurrence. Logical-Net IDs are
revision-scoped representatives and must be refreshed after edits.

Endpoint readiness separates physical membership from accepted intent, so a
singleton pin is not connected merely because it has a Base Net. ERC and
downstream checks consume the shared assessment rather than another stored
status. One ERC check reads geometry rather than membership:
`ERC_TOUCHING_NOT_CONNECTED` reports an instance pin whose contact point lies
on a Route of a different Logical Net. Geometry never creates a connection and
a Crossing is not a Junction, so nothing repairs that arrangement and nothing
else reports it — the author sees a wire reaching the pin while the netlist
sees the pin on another Net or on nothing. It judges terminals only: two
Routes crossing is the ordinary case the model already names, and a pin the
author declared `NoConnect` has been answered for. The [diagnostic envelope](../../packages/derived/src/diagnostics/diagnostic.ts)
keeps domains, confidence, severity and gate eligibility distinct.
[Editor interaction](editor-interaction.md) owns explicit checking and stale
result/navigation behavior; checks do not veto Save.

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

Base Nets remain physical connectivity. The pure Logical-Net resolver joins
distinct Base Nets through folded authoritative names in the same scope or
matching formal Cell-Pin names. The [model](schematic-model.md#electrical-authority)
owns those declarations and their marker identities. Reusing a spelling never
merges Route geometry. `net-name-hint` and `spice-source` are provenance only
and never join Nets.

Equal-folded local and global claims on an already-connected group derive an
effective global scope without rewriting either owner. Disconnected
local/global claims remain separate; different-name scope combinations and
incompatible power claims remain explicit errors.

The strict `connect_endpoints` primitive does not implicitly merge two Base
Nets. The authoring planner explicitly emits `merge_nets` first. If their
resolved names differ, it removes `net-label`-owned claims and their
Annotations on the two participating Base Nets before the merge. This is not
a blanket deletion of every owner in either Logical Net: supply markers,
formal Cell interfaces, and labels on other Base Nets remain. Incompatible
power domains are rejected, and any unresolved contract conflict still rejects
the atomic transaction.

This is the accepted explicit-join behavior: neither conflicting ordinary Label
is chosen as the surviving name. Retiring these owners can remove name-based
connections to remote Base Nets; those remote Labels are not themselves deleted.
The resulting Logical Nets are derived from the remaining owners. Label removal
and connection are one atomic, undoable operation.

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
This rule applies equally to hollow/filled Ports and every other terminal kind;
a persistent Junction object is not a prerequisite for a pin-on-Route dot.
The conductor normalizer also unions self-overlap within a single Route, not
only overlap between separately authored Routes.

## Transaction invariants

- Every terminal and Junction reference exists.
- Every Route endpoint agrees with the Route Net.
- A terminal belongs to at most one Net.
- Route normalization removes duplicate and collinear interior points without
  changing endpoint identity.
- Same-Net conductor normalization unions duplicate coverage, preserves every
  true branch/contact vertex, and removes every unowned degree-two ordinary-
  Wire Junction, independent of historical role or join angle.
- A failed multi-edit transaction changes nothing; a successful one advances
  revision once.
- GUI and Agent use the same planners, transaction engine, derived geometry,
  and diagnostics.
