# Schematic Model

Status: `accepted`

Primary owner: `packages/model`

The Project contains Documents; each Document owns revisioned electrical,
geometric, and presentation facts. The current model is strict schema 36 and has
no compatibility shape.

## Coordinate domains

ADR 0021 separates persisted grid coordinates from transient and derived
geometry. Every persisted page Point in a Document is a finite integer multiple
of that Document's `presentation.grid`: Instance placements, Junctions, Route
Route bends, persisted VisualAnchor point fields, and drafting points/controls/
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
  `Instance.reference` is its sole authored Reference when the Instance has
  one. The value is projected on canvas. Dialect emission may derive a card
  designator from typed invocation semantics (for example authored `M1` emits
  `XM1` for a reviewed SPICE external call) without mutating the Project. It is
  independent from stable `Instance.id` and typed master
  binding. A Cell Pin instead projects `CellTerminal.name` and has no Instance
  Reference.
- A Base Net owns physical terminal membership only. A terminal is
  `{instanceId, pinName}` and belongs to at most one Base Net.
- `ConnectivityEvidence` records owner-addressed name claims, explicit SPICE
  globals, non-electrical source-name hints, and SPICE source identity for one
  Base Net at a time. The pure Logical-Net resolver joins distinct Base Nets
  through matching folded authoritative names in the same scope or matching
  formal Cell-Pin names. A `net-name-hint` and `spice-source` record are
  provenance only and never join Nets. Equal-folded local and global claims on
  one already-connected group derive an effective global scope without
  rewriting either owner. Disconnected claims remain separate; different-name
  scope combinations and incompatible power claims remain explicit errors.
  There is no generic persisted equivalence edge.
- `Route` owns editable geometry for one Net and connects terminal or Junction
  endpoints only.
- `Junction` owns explicit branch/anchor geometry.
- `NoConnect` targets one terminal only and cannot overlap Net membership.
- `Document.netlist.terminals` is the ordered list of authored Cell Pins. Each
  declaration has a stable ID, name, direction, Net ID, and a singleton
  `interfaceInstanceIds` array pointing to its one ordinary canvas Cell Pin
  Instance. Equal folded names intentionally identify one Logical Net while
  the declarations and physical Base Nets remain independently editable. A
  declaration's Port Name may differ from a visible internal Net Label; the
  Port name supplies interface identity without overwriting that Label.

Canvas `port` and `port-filled` artwork has exactly one meaning: a Cell Pin.
Each is an ordinary single-pin Instance with pin `P`, owns exactly one ordered
Cell-Pin declaration, and uses ordinary Net membership and Route endpoints. The
model has no free-Port branch or separate Port collection. Equal Port Names do
not merge terminal identity, direction, Base Net, annotations, or lifecycle,
but they resolve to one Logical Net in the current Document.

Consumers that need a Cell's formal interface use the pure
`projectCellInterface` read model. It groups declarations by case-insensitive
Port Name, preserving the first declaration's order and spelling. The
projection is never persisted and never merges or rewrites authored objects.
It also creates no editing-time connectivity: hierarchy trace/highlight omits
a multi-member Formal Port unless independent electrical facts already place
every member on the same Logical Net.

VDD, Ground, route Net Label, and Power Rail all author the same
`name-claim`. Power Rail is editable Route/Junction presentation rather than a
separate electrical object. A marker claim owns its scope and optional supply
role. Power markers default global; ordinary Net Labels default local. `AVDD`
and `DVDD` are separate Logical Nets because their names differ,
even though both may carry the `vdd` role. Ground uses global SPICE node `0`.

High-level GUI Net naming starts from an existing candidate Base Net plus a
stable Net Label owner. It writes or updates that owner's `name-claim`; it
never emits `merge_nets` or creates a new `Net.name` projection. Matching
claims join only in the derived Logical-Net view. Physical contact alone uses
the internal Base-Net merge primitive. Explicitly contacting equal-folded
local and global Nets is permitted; the merged group's effective scope is
global while both authored claims remain unchanged.

The editor does not normalize from inert legacy Base-Net metadata or coalesce
Base Nets by text. Compatible same-name claims are ordinary logical identity;
conflicting claims block electrical export and the introducing transaction.

Canonical MOS Instances use `nmos`/`pmos` with D/G/S/B electrical pins. The
default `textbook-3terminal` variant is presentation-only. B membership is
explicit first, then materialized from a configured cell-default Net. Without
either, it remains unresolved; MOS polarity never creates or selects a power
Net. Existing persisted `supply-default` bindings remain readable for
compatibility, but current manual authoring does not create them.
Cross-Document composition converts an effective source `cell-default` to an
instance-owned `instance-override` so target Cell policy cannot retarget the
copied body.
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
`instance-reference` resolves only `Instance.reference`. It, `net-name`, and
`cell-terminal-name` may use a same-text Annotation RichText `formatOverride`;
`instance-value` resolves typed component parameters. A visible master label or
other custom object-attached text is a literal Annotation and has no identity
or export authority. Renderers never derive visible Instance text from IDs,
master bindings, provenance, or copied properties. Drafting objects are
visual-only and cannot create connectivity.

An Annotation may independently persist presentation-only `textColor`. With
that field absent, an `instance-label` or `instance-value` inherits the owning
Instance's effective foreground; all other annotation kinds use the Document
profile foreground. A semantic binding identifies the owning Instance before
an object anchor does. Annotation paint never changes electrical topology,
netlisting, SPICE parameters, or the owning Instance style.

RichText has one canonical persisted authority. A document is either ordinary
Razavi styled runs or one atomic formula run containing bounded LaTeX source
and an explicit inline/display mode. Generated formula SVG, font paths, bounds,
and caches are derived and are never persisted. Formula source cannot create
connectivity or a second annotation identity.

A Cell definition may additionally persist optional `presentation.cellSymbol`
intent: a symbol-local minimum body size and unique `terminalId`-keyed visual
side/offset placement. It is not electrical terminal data, parent-instance
geometry, or persisted artwork. The Symbol resolver derives the block and all
pin anchors. Each placement must reference one existing formal terminal and no
two explicit placements may occupy the same side/offset slot.

## Core invariants

- IDs are unique within their object class and every reference resolves.
- A Route's Net agrees with both endpoints. Its non-final legs end at stable
  bend IDs and its final leg ends at the Route endpoint; every leg owns its
  own mode and stable ID.
- Net membership and NoConnect are mutually exclusive.
- Layout groups and constraints reference existing objects.
- Cell-Pin declarations reference existing Nets and connected Port Instances
  with unique stable IDs and singleton marker bindings. Formal Port names are
  unique only after read-only name projection.
- Internal subcircuit bindings reference one child Document; their emitted
  Cell name is derived from that child. External bindings reference one
  project-level external definition, and unresolved imported bindings retain
  only a target name until resolution.
- The sole authored Reference lives in `Instance.reference`. Primitive cards
  use it directly; external SPICE calls derive an `X` card designator and
  validate the derived identifier for per-Cell collisions. Parameters live in
  `Instance.netlist`.
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
Junction at the endpoint's grid landing; its derived artwork-to-grid escape
disappears with the Instance. Deletion is a separate atomic composition
that clears membership, NoConnect, owned annotation, and unlocked layout
references before removing the Instance.

Mutation occurs only through atomic Edit Engine transactions against an exact
Document revision. GUI and Agent writes use the same schema and invariants.
Formal-interface edits and add/remove Document operations are composed with
ordinary Schematic edits inside one Project structural transaction. The
Project's `structureRevision` protects this cross-Document boundary and the
editor records it as one undoable structural commit.

Persistence writes only schema 36. The reader carries every schema in its
explicit 24→36 upgrade chain forward, then supplies the current model only; no
compatibility shape enters runtime electrical derivation. The 32→33 step
rejects ownerless equivalence rather than guessing replacement connectivity.
The 33→34 step converts hidden imported names into non-electrical hints or
explicit global declarations and materializes an existing power owner where
one is available. The 34→35 step converges parallel Instance naming fields to
one Reference and materializes distinct visible text as an Annotation. The
35→36 step repairs reference-shaped labels that were materialized as literal
text, maps them to the owning Reference, and retains their RichText styling.
