# Schematic Model

Status: `accepted`

Primary owner: `packages/model`

The Project contains Documents; each Document owns revisioned electrical,
geometric, and presentation facts. The current model is strict schema 22 and has
no compatibility shape.

## Coordinate domains

ADR 0021 separates persisted grid coordinates from transient and derived
geometry. Every persisted page Point in a Document is a finite integer multiple
of that Document's `presentation.grid`: Instance placements, Junctions, Route
waypoints, persisted VisualAnchor point fields, and drafting points/controls/
centers. This is a complete-Document invariant, not merely an editor snap
preference.

Renderer bounds, rich-text layout, route-relative anchor resolution, curves,
rotated corners, diagnostics, pointer/screen positions, and symbol-local
artwork may use finite floats. They are read-only or transient coordinate
domains and must never be persisted as a Document Point. Parametric scalars
such as route-anchor `t` and normal offset are not page Points.

Project parse accepts no legacy non-grid shape and performs no rounding or
migration. Invalid coordinates are rejected with their data path.

## Electrical authority

- `Instance` selects one exact canonical symbol and optional visual variant.
  `Instance.schematicReference` is its canvas-facing Reference when the
  Instance has one, independent of the optional emitted
  `Instance.netlist.reference`. A free Net Port projects its owner-addressed
  name claim; a formal Cell Pin projects `CellTerminal.name`. Neither Port role
  has a visible schematic reference.
- A Base Net owns physical terminal membership only. A terminal is
  `{instanceId, pinName}` and belongs to at most one Base Net.
- `ConnectivityEvidence` records owner-addressed names, SPICE source identity,
  and explicit equivalence. The pure Logical-Net resolver is the only place
  these facts are folded. Conflicting name, scope, or power claims remain
  explicit errors; no claim type silently wins.
- `Route` owns editable geometry for one Net and connects terminal or Junction
  endpoints only.
- `Junction` owns explicit branch/anchor geometry.
- `NoConnect` targets one terminal only and cannot overlap Net membership.
- `Document.netlist.terminals` is the ordered formal Cell interface. Each
  terminal has a stable ID, name, direction, Net ID, and a non-empty
  `interfaceInstanceIds` array pointing to its ordinary canvas Port marker
  Instances. Its interface name may differ from its internal Logical-Net name.
  Repeated markers are views of one terminal, not duplicate formal pins.

Canvas interface markers `port` and `port-filled` are ordinary single-pin
Instances with pin `P`; their electrical membership and Route endpoints are
represented exactly like every other component terminal. The model has no
separate canvas Port collection or Port-specific Net membership.

VDD, Ground, Free Port, route Net Label, and Power Rail all author the same
`name-claim`. Power Rail is editable Route/Junction presentation rather than a
separate electrical object. A marker claim owns its scope and optional supply
role. Power markers default global; ordinary Net Labels and Free Ports default
local. `AVDD` and `DVDD` are separate Logical Nets because their names differ,
even though both may carry the `vdd` role. Ground uses global SPICE node `0`.

High-level GUI naming starts from an existing candidate Base Net plus a stable
Label or Free-Port owner. It writes or updates that owner's `name-claim`; it
never emits `merge_nets` or creates a new `Net.name` projection. Matching
claims join only in the derived Logical-Net view. Physical contact alone uses
the internal Base-Net merge primitive.

The editor does not normalize from inert legacy Base-Net metadata or coalesce
Base Nets by text. Compatible same-name claims are ordinary logical identity;
conflicting claims block electrical export and the introducing transaction.

Canonical MOS Instances use `nmos`/`pmos` with D/G/S/B electrical pins. The
default `textbook-3terminal` variant is presentation-only. B membership is
explicit first, then materialized from a configured cell-default Net. Without
either, it remains unresolved; MOS polarity never creates or selects a power
Net. Existing persisted `supply-default` bindings remain readable for rolling
compatibility, but current manual authoring does not create them.
Imported/source-bound MOS instances with missing fourth-node evidence remain
unresolved.

A visible `bulk-dashed` route is an explicit override. The override atomically
removes the implicit cell-default binding before connecting B to the selected
body-bias Net, so the default never remains as a hidden parallel connection.

## Presentation authority

Every visible editable label is a `SchematicAnnotation` with bounded RichText
`content` and one `VisualAnchor`. Anchors are free, object-relative, or
route-relative and include a deterministic fallback position for dangling
visual references. While an anchor resolves, its resolved position is the one
text baseline used by rendering, editor hit/marquee geometry, export bounds,
and visual diagnostics; `fallbackPosition` is used only for a dangling target.
`instance-schematic-name` resolves RichText `schematicName` and only then the
internal schematic/netlist reference; `instance-designator` resolves an
optional, read-only network ID. `net-name` and `cell-terminal-name` resolve
their semantic source and may use a same-text Annotation RichText
`formatOverride`; `instance-master-name` and `instance-value` resolve their own
source. Renderers never derive visible
instance text from IDs or copied properties. Drafting objects are visual-only
and cannot create connectivity.

A Cell definition may additionally persist optional `presentation.cellSymbol`
intent: a symbol-local minimum body size and unique `terminalId`-keyed visual
side/offset placement. It is not electrical terminal data, parent-instance
geometry, or persisted artwork. The Symbol resolver derives the block and all
pin anchors. Each placement must reference one existing formal terminal and no
two explicit placements may occupy the same side/offset slot.

## Core invariants

- IDs are unique within their object class and every reference resolves.
- A Route's Net agrees with both endpoints and its segment count agrees with
  its waypoints.
- Net membership and NoConnect are mutually exclusive.
- Layout groups and constraints reference existing objects.
- Netlist interfaces reference existing Nets and connected Port Instances with
  unique stable IDs, ordered names, and marker bindings.
- Internal subcircuit bindings reference one child Document; their emitted
  Cell name is derived from that child. External bindings reference one
  project-level external definition, and unresolved imported bindings retain
  only a target name until resolution.
- Netlist references and parameter values live in `Instance.netlist`.
  Parameters are defined only by the matching Device Descriptor: every field
  declares its key, requiredness, editor kind, optional unit/example/help, and
  display role. Insert, Properties, validation, Value projection, and export
  consume that definition; UI adapters do not maintain a second parameter
  registry.
  Imported terminal order and symbol-mapping identity live only in typed
  `Instance.importProvenance`; `Instance.properties` does not persist.
- `electricalTopologyHash` includes Instances, Nets, terminal membership,
  Routes, Junctions, NoConnects, and formal cell terminals, but excludes
  placement, annotation, and drafting presentation.

An Instance has three lifecycle states: retained in the Placement Tray
(`placement: null`), placed (`placement` present), or deleted (absent). Returning
to the Tray retains every electrical, netlist, and object-anchored annotation
fact, but retained-instance annotations are not rendered or hit-testable until
the Instance is re-placed. Any visible Route endpoint is first detached to a
Junction at the resolved pin position. Deletion is a separate atomic composition
that clears membership, NoConnect, owned annotation, and unlocked layout
references before removing the Instance.

Mutation occurs only through atomic Edit Engine transactions against an exact
Document revision. GUI and Agent writes use the same schema and invariants.
Formal-interface edits and add/remove Document operations are composed with
ordinary Schematic edits inside one Project structural transaction. The
Project's `structureRevision` protects this cross-Document boundary and the
editor records it as one undoable structural commit.

Persistence writes only schema 22. `packages/project-protocol` accepts schema
21 through the bounded direct upgrade defined by ADR 0039, then supplies the
current model only; no compatibility shape enters `packages/model`.
