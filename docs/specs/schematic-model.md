# Schematic Model

Status: `accepted`

Primary owner: `packages/model`

The Project contains Documents; each Document owns revisioned electrical,
geometric, and presentation facts. The current model is strict schema 58 and has
no compatibility shape.

## Coordinate domains

Presentation rationale separates persisted grid coordinates from transient and derived
geometry. Every persisted page Point in a Document is a finite integer multiple
of that Document's `presentation.grid`: Instance placements, Junctions, Route
bends, persisted VisualAnchor point fields, and drafting points/controls/
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
  one. The value is projected on canvas and is the exact ngspice card
  designator: primitive/model MOS, resistor, and capacitor bindings use
  `M/R/C`, while every internal or external subcircuit call uses `X`. Changing
  invocation kind changes the Reference in the same undoable transaction. It
  remains independent from stable `Instance.id` and typed master binding. A
  Cell Pin instead projects `CellTerminal.name` and has no Instance Reference.
- A Base Net owns physical terminal membership only. A terminal is
  `{instanceId, pinName}` and belongs to at most one Base Net.
- `ConnectivityEvidence` records owner-addressed name claims, explicit SPICE
  globals, non-electrical source-name hints, and SPICE source identity for one
  Base Net at a time. There is no generic persisted equivalence edge.
  [Connectivity](connectivity-and-routing.md#net-naming-and-lifecycle) owns
  derived name equivalence, effective scope and conflict behavior; source
  evidence remains non-electrical provenance.
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
VDD Power also owns a Cell-Pin declaration by default and can be switched
explicitly to a Global marker in Properties. A local Power Rail owns a formal
terminal directly through its `power-label` annotation; it does not require a
hidden Instance. Instance-owned formal terminals use an ordinary single-pin
Instance with pin `P`. Each formal terminal has exactly one interface owner and
uses ordinary Net membership and Route endpoints. The model has no
free-Port branch or separate Port collection. Equal Port Names do not merge
terminal identity, direction, Base Net, annotations, or lifecycle, but they
resolve to one Logical Net in the current Document.

Consumers that need a Cell's formal interface use the pure
`projectCellInterface` read model. It groups declarations by case-insensitive
Port Name, preserving the first declaration's order and spelling. The
projection is never persisted and never merges or rewrites authored objects.
It also creates no editing-time connectivity: hierarchy trace/highlight omits
a multi-member Formal Port unless independent electrical facts already place
every member on the same Logical Net.

Ground, Global VDD, route Net Label, and Power Rail author the same
`name-claim`. A local VDD Power Cell Pin gets its name from the formal terminal
and derives the `vdd` role from its interface owner. A local Power Rail combines
editable Route/Junction presentation with an annotation-owned formal terminal;
an explicitly global Power Rail has the claim but no terminal. A marker claim
owns its scope and optional supply role. New VDD and Power Rail authoring
defaults local; Ground remains global SPICE node `0`. `AVDD` and
`DVDD` are separate Logical Nets because their names differ, even though both
may carry the `vdd` role.

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
A formal Cell Pin combined with a Global declaration on the same Logical Net is
also a blocking contract conflict; the two interface modes are mutually
exclusive. The established global SPICE ground reference `0` remains the sole
exception so Ground keeps its existing placement and routing behavior.

Canonical MOS Instances use `nmos`/`pmos` with D/G/S/B electrical pins. The
default `textbook-3terminal` variant is presentation-only. B membership is
explicit first, then materialized from a configured cell-default Net, and
failing both it follows the one wired supply marker of its domain in that Cell
— `ground` for an NMOS body, `vdd-port` for a PMOS body — resolved on read as
`supply-default` and never written into persisted connectivity. A Cell with no
such marker, or with more than one, leaves the body unresolved. Strict
extraction reports `MISSING_PIN_NET` for an unresolved body unless an explicit
NoConnect supplies the separate floating-node contract; no export guesses a
supply from device polarity or from a Net's spelling, and a marker is an
authored placement rather than a guess. Nothing writes a new `supply-default`
binding; persisted ones from an earlier release remain readable for
compatibility.
Cross-Document composition converts an effective source `cell-default` to an
instance-owned `instance-override` so target Cell policy cannot retarget the
copied body.
Imported/source-bound MOS instances with missing fourth-node evidence remain
unresolved and follow the same missing-terminal export rule.

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
or export authority. A device's visual `instance-label` starts as a Reference
projection; canvas content editing switches that same object to literal
`content`, removing `binding` and `formatOverride`. Only an explicit reset
restores following. `Instance.reference` is the Netlist Reference, not a second
editable presentation string. No extra stored label field is needed.
Renderers never derive visible Instance text from IDs,
master bindings, provenance, or copied properties. Drafting objects are
visual-only and cannot create connectivity.

Rectangle and circle drafting objects may independently override border and
opaque fill paint. Their optional `layer` selects the background plane below
circuit artwork or the foreground plane above annotations; an absent layer is
foreground for compatibility. `zIndex` orders objects within each plane.

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
  and subcircuit calls use it directly. Its prefix must agree with the current
  invocation kind and it is unique under case folding within the Cell.
  Parameters live in `Instance.netlist`.
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

The [Project file format](project-file-format.md) owns the current schema,
supported compatibility floor and read/write boundary. Migration transforms
preserve authored intent before handing current-only data to this model;
their implementation and tests, not a second chronology here, own the steps.
[Simulation](simulation.md) owns Project-level source folders and repairable
references; removing a referenced Cell may diagnose preparation without
invalidating the saved Project. Simulation output labels never name or join
circuit Nets.
