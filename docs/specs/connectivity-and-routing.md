# Connectivity and Routing

Status: `accepted`

Primary owners: `packages/model`, `packages/edit-engine`, `packages/derived`

## Model

- Runtime `Net.terminals` indexes Base-Net physical membership; portable files
  store [connection facts](project-file-format.md#one-connection-source).
  Logical connectivity resolves from membership, owner-addressed names, scope
  and interfaces. A terminal is an Instance pin (`port`/`port-filled` use pin `P`).
- A scalar Route belongs to one Net and joins terminal or Junction endpoints: one
  `start` plus ordered legs ending at stable dot-free bends, each leg with its
  own mode and stable `legId`.
- Crossings never connect. Collinear same-Net overlap is never persisted: the
  Edit Engine unions coverage, materializes branch vertices and removes every
  unowned degree-two ordinary-Wire Junction (arms coalesce; an angle becomes a
  bend), whatever its historical role. Rail, MOS bulk and locked geometry stay
  out of the union, as do aggregate bus paths. Overlapping styles: largest coverage wins, Route ID breaks
  ties.
- A [Junction color override](visual-language.md#style-overrides) owns its
  Junction through conductor normalization. An unreferenced styled Junction at
  a terminal contact travels when all of that contact's pins travel together;
  separating pins retains the existing direct-contact stretch behavior.
- An explicit cross-Net Wire connection merges compatible Base Nets first;
  passive geometry never merges Nets.
- Opening a portable file normalizes an imported copy and marks it dirty; Cloud
  opens, recovery and the parser never rewrite on read. File/Gallery import
  copies drop an ordinary Route that collapses to one point after anchor
  correction only when both ends stay on its Net and nothing owns it.
- `orthogonal` (default), `octilinear` and `free` constrain only the unresolved
  authored leg; `power-rail` is one straight non-zero horizontal or vertical
  segment. All share one segment kernel and Route transaction.

## Ordered signals and buses

- Explicit Cell Pin and Net Label authoring accepts a scalar, `NAME<index>`,
  inclusive `NAME<first:last>` in either direction, ordered lists such as
  `DATA<7,3,0>`, and comma-separated bundles such as `CLK,RESET,DATA<3:0>`.
  Members must be unique under logical Net name case folding; selection uses
  the same comparison and preserves the authored spelling. Expressions are
  bounded to 256 characters and 256 members; indices are 0–65535. Expansion order is
  electrical order. Text editing previews that order and width; invalid Enter
  keeps the draft, Escape discards it. Old names without a signal
  declaration remain scalar.
- A vector formal terminal owns ordered stable member IDs, each on a scalar
  Base Net. Its generated parent Symbol has one aggregate pin. A Route's
  ordered member mappings join scalar endpoints, never one aggregate Net;
  Junctions retain ordered member identities. Parent names are independent of
  child formal names. Initial equal-width connections map the two declared
  lists positionally, including opposite orders.
- Wire uses the existing routing modes, corners, snapping and cancellation.
  `L` edits the unfinished Wire's name in place: Enter resumes routing,
  Escape restores its previous name and path; Escape while routing cancels
  the whole draft. Text focus owns typing and Backspace. The completed path,
  naming owner and mapping commit together in one undoable transaction.
  A vector source supplies width; a loose unnamed conductor can acquire width
  from a vector Label. An accepted scalar Label fixes a loose draft to one
  member; landing on a bus resolves or asks for that member. Scalar contacts
  require a selected member. A unique
  authoritative name in the parent Document may select it; otherwise the
  inline chooser remains editable. Hover and commit evaluate the same landing.
- Whole-bus continuation preserves every member and is the default. The
  contextual selector accepts a scalar, slice or ordered list; shorthand
  `<3>`, `<7:4>` or `<7,3,0>` requires one explicit indexed source context.
  Selections resolve to ordered stable member IDs and can be tapped again.
  Landings require equal widths and map those lists positionally in either
  drawing direction. Invalid choices retain the draft with a reason.
- A branch and its bound selector commit together; the selector follows its
  ordered scalar members and is removed with the branch. Member endpoints
  never acquire connections from passive crossings or aggregate pin coincidence.
- A selector's display binding identifies the selected endpoints/members. It
  reads the parent Net name, falling back to the current formal member name
  when unnamed. This fallback is display-only: it creates no name claim or
  virtual label connection. Stale text formatting cannot hide a changed name.
- Bus stroke and tap slashes are presentation. Width overrides change ink,
  never membership. Aggregate Junctions have no scalar junction dot. Formal
  SVG, PNG and PDF share this geometry and exclude editing controls.
- Unknown members, unequal widths and malformed expressions refuse atomically.
  Fixed scalar sources cannot acquire vector or bundle width from a Label.
  No Connect accepts one explicit member or an explicit member set. Each mark
  excludes only that member from missing-connection ERC; connected members need
  explicit disconnection first. Mark, clear and disconnection are atomic and
  follow stable identities through interface rename/reorder and undo.
- Continuous taps opt in to ascending/descending order or intentional fanout.
  Successful branch transactions advance the shown member; invalid/cancelled
  drafts do not. Exhaustion stops without wrapping. The session belongs to
  Wire and uses its existing Label focus, routing controls and Escape behavior.
- Selecting scalar branches and invoking L can expand an expression into Labels
  in selection order. Equal counts and distinct scalar Nets are required; all
  Labels use normal naming/anchoring rules and commit together in one undo.
- Member inspection and hierarchy traces are read-only. They show full member
  names, concrete caller occurrences and parent/child mapping, using stable
  member identity after rename/reorder. Existing Issues locators identify the
  member whose connection is missing; formal exports exclude inspection overlays.
- Editing a bus source Pin or Label, or a connected scalar Pin, previews the affected interface and member
  mapping. Matching names retain stable identity; other renames and removed
  members require an explicit target or disconnect. Reordering follows identity,
  added members start disconnected, and removed contacts remain editable stubs.
  Affected callers, bound selectors and the edited naming owner change atomically
  with one Undo; unrelated owners keep their definitions.
  Cancelling, stale previews and invalid mappings leave the Project unchanged.
  An unconnected scalar Pin can become a bus directly from inline text; its
  unused scalar identity is replaced by fresh members without inferred mapping.
- Legacy scalar names remain literal on load. Convert to bus explicitly maps
  each existing scalar contact to one new member or disconnects it; it never
  fans a scalar connection into every member. Native and PDK interfaces retain
  their refusal with an explanation.

## Completed-edit connectivity

- Wire authoring submits endpoints and a path; `set_route_path` and
  `route_orthogonal` `netId` is a hint, not a connection.
- After all geometry and endpoint-follow edits, one transient graph of surviving
  Routes and confirmed contacts partitions/merges Base Nets, retargets labels,
  interfaces and bulk bindings, settles contacts and normalizes coverage; naming
  and schema validation run on that final candidate, so cut order never matters.
  A repointed Route releases a pin nothing else holds; a shared Net ID connects
  nothing.
- Unrouted/imported membership is intent: reconstruction keeps bridges between
  its former components (no clique) and never restores a formerly routed edge.
  `cut_connection` releases it; `remove_route_geometry` and returning a part to
  the tray keep it. `connect_endpoints`, `merge_nets` and
  `set_property_terminal_net` are logical (an undrawn pin keeps its named Net).
- This runs at edit commit only; edits never bulk-rewrite Gallery files. Undo
  restores the whole document.

## Authoring rules

- Ends on terminals or Junctions create/join membership atomically through one
  `EndpointConnection`; only electrical-lattice landings and bends persist
  (Document grid; dense pins may use the 2-unit subgrid). MOS B uses the same
  transaction; `bulk-dashed` is presentation.
- Exact visible endpoint coincidence is a contact. When placement, a Junction, a
  rail, a typed attach or edited geometry newly reaches a visible endpoint, the
  Base Nets merge; incompatible domains or name conflicts reject. Only newly
  covered points count. A same-transaction `disconnect_endpoint` suppresses
  reconnection and is never reported as preserved.
- Releasing a wire end on a conductor bonds whichever handle was dragged (the
  drawing is the same): a pin, a bare end, or a span split at a Junction.
  Dragging a segment onto a pin or Junction connects there. A loose end is
  legitimate. A terminal-anchored end is re-pointable in one undo; the pin
  leaves the Net unless another Route holds it.
- A transform separating a confirmed direct contact materializes one ordinary
  Route afterwards unless the ends moved together or another path exists;
  restoring the contact removes it (not membership) unless owned.
- A tap or new Junction on a Route splits it; dots derive from branches. Cutting
  a branch coalesces the unowned degree-two Junction; continuing from a loose end
  extends the conductor. Labels, markers, layout references and legs follow.
- Series splice: a part with one eligible pin pair on one continuous ordinary
  Route splits it, removes the span between and partitions the Net. Two-terminal
  parts are eligible; multi-pin parts only via the descriptor pair (D/S for MOS,
  C/E for BJT). A pin inside a Route with the other on its end is the same
  splice. Rails, bulk, locked geometry and undeclared pairs never cut. A
  placement or move leaving a two-pin part's pins on one Logical Net is refused
  (a move then completes unconnected).
- Moving an Instance stretches its Routes. A typed move (Properties, Agent
  `move`) reroutes a stretch that would cross a part or another Net along the
  Agent `connect` path, else keeps the stretch; drags keep the stretch. Paths
  avoid parts, pins and Nets, not labels.
- When a typed move/turn, Agent `arrange`, Properties pin change, or a caller
  following changed Pins newly covers a part's labels, they are arranged as
  `arrange-labels` would, as a group, in the same undo; a caller's default-slot
  labels first follow the new block.
- Placement and drag moves share the contact planner (final geometry, joins
  folded before splits). A dragged pin joins the stationary conductor its final
  position lands on, snapped there or lined up with something else; a free
  (Alt) drag and other passive moves gain no contacts; wired devices attach
  rather than splice.
- Wire Delete uses `cut_connection`, recomputing physical components so no
  evidence hides a disconnection; `remove_route_geometry` removes geometry only.
  Route-anchored labels are removed by a typed edit first. A cut never strands
  a pin no one can draw (a hidden supply pin, a model's substrate): it stays
  with its Net's largest remaining component. A label naming a Net that holds
  no pin, wire or Junction stays on it.
- Transform, `C` copy, graph deletion, marker rename and whole-Net rename compile
  one transient `RoutingOperationPlan` (stable-ID closure, expected effect,
  typed edits, ID remap) validated by an independent before/after projection.
  It is neither Project data nor Agent protocol.
- Transforms move internal Routes rigidly, stretch boundary Routes at the inside
  end (shared stretch kernel) and leave external Routes; nothing unrelated
  reroutes; protected geometry rejects atomically; zero-length wires and steps
  are dropped rather than refusing. Drag preview and release use the same plan
  against its source revision, one undo.
- Copy (`C` or copy/paste, any tab, Agent and workspace) takes the selected
  internal subgraph; boundary Routes and external membership stay (copied
  boundary pins open). Selected Pins, markers and labels rejoin only by
  `name + scope`; names owned by unselected objects, Bulk overrides and scalar
  No Connects stay. Member No Connects travel with their selected caller and
  use the same owner-scoped member mapping; a whole Cell takes its names,
  No Connects and testbench.
  Bus members follow their stored identities and ordered mappings. New local
  contacts receive fresh identities; callers of a reused Cell retain its formal
  identities. Imported Cells, captured caller artwork, selector bindings and
  naming claims travel together. Explicitly copied boundary wires terminate on
  independent local anchors. Names, scope and authored formatting stay intact.
  A selector whose naming owner stays behind retains its captured display as
  a presentation fallback; a live name takes precedence, and the fallback
  creates no naming claim or logical connection.
  No labels are synthesized; provenance travels but never rejoins.
- Delete is one graph operation: Route geometry dominates incidental Junction
  dots; Junction-only deletion owns its arms; orphans and unreferenced local
  Nets are cleaned in the same transaction.
- `NoConnect` and membership are exclusive. Snap, selection, highlight,
  clipboard, undo, Agent Snapshot and render share resolved endpoint geometry.

### MOS bulk

- A manual MOS without explicit B resolves its body: the configured Cell
  default, else `supply-default`, the Cell's single wired Net of the power
  domain (ground for NMOS, positive supply for PMOS). Power domain comes only
  from authored evidence (`ground`/`vdd-port` marker, rail or supply Pin claim),
  never spelling, polarity or proximity. None or several (VDD beside AVDD)
  leaves it unresolved; unwired markers do not count.
- Pasting a supply marker sets a missing default like placing one. A body alone
  on a Net its own policy binding named (no geometry, claim or terminal) is
  residue: it resolves through the order above and the next edit reconciles it.
- Extraction uses actual membership and the same order; an unresolved body
  exports as [netlist export](netlist-export.md#implicit-supplies-and-mos-bodies)
  states, with `MOS_BODY_OTHER_SUPPLY` asking about a body off its source's supply.
- A `bulk-dashed` route from B (GUI or Agent `connect`/`route-net`) treats the
  default as unowned and clears the binding. Deleting it reconciles only an
  explicit default. Source-bound MOS keep fourth-node evidence; a split imported
  B-only fragment returns to the default only if both Nets share source evidence
  and the fragment owns nothing.
- `supply-default` is derived on read; nothing writes it and persisted ones stay
  readable (never residue). Cross-Document composition materializes a source
  `cell-default` as an `instance-override`.

### Rails and supplies

- A `power-rail` Route needs a Base Net with an explicit `powerDomain: vdd`
  name claim. Authoring creates or reuses the name (explicit scope, else local)
  with two route-anchor Junctions, the Route and one net-name-bound RichText
  label, and no VDD Instance. Ends resize along the axis; moving carries taps;
  deleting a segment or label removes the whole rail and name closure; a cut
  stranding an unnamed rail is not an operation.
- A named global Net bridges by itself (no trunk, no flightline); local names
  need route, contact or label evidence.
- A formal Pin on a supply marker carries the supply's global identity; any other
  formal Pin on a global Net is `FORMAL_PORT_GLOBAL_NET_CONFLICT`.
- Before a cut, markers sharing a legacy claim each materialize the unambiguous
  supply claim (copy and composition see the same view); explicit claims are
  never replaced; when visible Ground owners take `0`, the source-wide ground
  declaration retires. Import copies may recover an unnamed Ground marker on a
  split Base Net only when a surviving explicit global `0` backs it.

## Wire cut lifecycle

- `cut_connection` needs one unlocked Route; removing a bridge partitions by
  remaining Routes and contacts, never suppressed by global, imported or name
  evidence; a redundant cycle keeps the Net.
- The component with the deleted Route's first surviving endpoint (start before
  end) keeps the ID, else the first deterministic component; others get
  deterministic new IDs. Orphaned Junctions go unless owned; Route-anchored
  annotations need a preceding typed edit.
- The [Edit Engine](edit-engine.md#operations-and-state-transitions) owns
  atomicity, revision and Undo.

## Shared read and diagnostic boundary

- [ProjectConnectivityIndex](../../packages/derived/src/connectivity-index.ts) is
  derived and never persisted. Search, trace and diagnostics share ObjectLocator
  and HierarchyFrame; unresolved paths never guess; Logical-Net IDs are
  revision-scoped. Selection is not electrical input.
- Endpoint readiness separates membership from intent; ERC consumes the shared
  assessment; checks never veto Save ([editor interaction](editor-interaction.md)).
  The [diagnostic envelope](../../packages/derived/src/diagnostics/diagnostic.ts)
  keeps domain, confidence, severity and gate eligibility distinct.

| Code                           | Reports                                                                                                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ERC_TOUCHING_NOT_CONNECTED`   | A pin on another Logical Net's Route, or two pins on one point on different Logical Nets (each pair once). Crossings and `NoConnect` pins exempt.                                   |
| `ERC_DANGLING_WIRE`            | A wire end at a Junction nothing else reaches; rail ends, labelled wires and ends with a same-Net label within four grid steps exempt.                                              |
| `ERC_NET_LABEL_NAMES_NOTHING`  | A Net Label whose Net reaches no pin, wire or Junction.                                                                                                                             |
| `ERC_LABEL_REFERENCE_MISMATCH` | A name label reading another part's name while that part shows something else.                                                                                                      |
| `ERC_UNDRIVEN_GATE_NET`        | Two or more sense-only pins (gate, bulk, block input) with no Cell Pin, global/supply name or other pin (capacitors drive; local names do not). A lone gate is `ERC_FLOATING_GATE`. |
| `ERC_SHORTED_DEVICE`           | A two-pin part with both pins on one Logical Net.                                                                                                                                   |
| `ERC_NET_JOINED_ONLY_IN_DATA`  | A drawn part of a Net no wire or own name joins to the rest (touching counts; unwired pins are `ERC_UNCONNECTED_PIN`; guided imports skipped).                                      |
| `ERC_OVERLAPPING_NETS`         | Error: different Logical Nets' wires along one line over a common span (each pair once, with span).                                                                                 |
| `ERC_INSTANCE_NOT_DRAWN`       | Instances the sheet does not draw.                                                                                                                                                  |

## Imported routing guidance

- SPICE import creates membership first, archives the input and freezes terminal
  groups in `importReference`; `spice-source` is lineage only.
  `deriveRoutingGuidance` is a pure minimum-spanning tree over each frozen
  group's mapped endpoints.
- Routes, contacts and current names express connections; unrouted membership
  does not hide guides. Comparison is Cell-definition scoped; open, short,
  missing and unplaced findings are non-blocking Issues; provenance never
  exempts a singleton from ERC.
- A guide is transient presentation carrying both ends' current Base Net (null
  if unbound); clicking rechecks and starts the ordinary Wire path; highlighted
  Nets hide their guides; unplaced ends stay in the tray.
- A cut splits imported and global Nets too: only the primary component keeps the
  unowned imported name projection; provenance is copied to all. Legacy imports
  without a frozen reference show an unavailable observation.

## Net naming and lifecycle

- Base Nets are physical. The pure Logical-Net resolver joins them by folded
  authoritative names in one scope or matching formal Pin names
  ([model](schematic-model.md#electrical-authority)); spelling never merges
  geometry; `net-name-hint`/`spice-source` never join.
- Equal local and global claims on one connected group derive global scope;
  disconnected ones stay separate; cross-scope name or power conflicts are
  errors.
- A Net Label on a formal Pin must match its name (case-insensitive); new
  conflicts reject, imported ones show in ERC and block formal export. After a
  cut, same-name owners stay joined by name; different Pin names on one
  physical Net keep separate interfaces.
- `connect_endpoints` never merges implicitly; the planner emits `merge_nets`
  first and, when names differ, removes only the `net-label` claims on the two
  participating Base Nets (supply markers, interfaces and remote labels stay) in
  one undo; incompatible domains reject.
- Flattened composition copies owner-addressed claims into the target namespace;
  hierarchy, not hidden domains, isolates local names.
- Renaming a marker moves only that owner; renaming a Logical Net updates its
  editable claims without merging Base Nets.
- Same-name Ports, markers and rails are legal; `powerDomain: vdd` is a role, not
  a singleton.
- SPICE import sets a polarity's MOS bulk default only when all its B terminals
  share one Net. Deleting the last owner never leaves a ghost Net.

## Derived read models

- `ResolvedRouteGeometry` is the shared geometry for render, hit, drag, markers,
  diagnostics, export and Agent Snapshot; nobody reconstructs contacts from
  Symbol coordinates.
- `deriveDocumentContactEvidence` is the sole reader of confirmed contacts; the
  transaction connectivity normalizer and conductor-topology normalizer are the
  write sides (including self-overlap). Readers never compensate for overlaps or
  missing T vertices.
- Route queries are read-only derived modules; normalization, authoring,
  stretch and `RouteEditPlan` belong to `@icm/edit-engine`.
- A dot means branch topology: arms and stems count by distinct visible
  direction; three directions or three coincident terminals require one, for
  any terminal kind. Bends are not contacts.

## Transaction invariants

- References exist; Route endpoints agree with their Net; a terminal is in at
  most one Net.
- Normalization keeps endpoint identity and every true branch vertex.
- A failed transaction changes nothing; a successful one advances revision once.
- GUI and Agent share planners, engine, geometry and diagnostics.
- Agent `connect` avoids other Nets' pins and wires and part bodies: without via
  points it takes the cheapest clear path or refuses; with via points it refuses
  naming the obstacle; point-to-point wires draw as asked. A first/last leg that
  would run along its own Net's wire taps it at the first meeting.
- An Agent transaction or dry run leaving a Junction on another Net's Route
  (`VISUAL_AMBIGUOUS_JUNCTION`) is refused.
