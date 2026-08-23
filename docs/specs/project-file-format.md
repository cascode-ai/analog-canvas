# Project File Format

Status: `accepted`

Current Project schema: `22`

Primary owners: `packages/model` (current shape) and
`packages/project-protocol` (file boundary)

An `.icproj.json` file is canonical JSON for one complete `CircuitProject`.
`@icm/project-protocol` exposes `parseProject` and accepts Project schemas 21
and 22. Schema 21 advances directly to 22 by adding deterministic Connectivity
Evidence for existing explicit Net names, Net/power Labels, and imported Net
source membership. Every reader returns the sole schema-22 in-memory Project
shape; schema 20 and older and all future versions are rejected. There is no
sequential migration registry or second in-memory Project shape.

## Current authorities

- `Document.netlist.terminals` defines the ordered formal Cell interface with
  stable identity, direction, Net binding, and one or more ordinary Port marker
  Instances.
- `Document.netlist.formalParameters` and project-level
  `externalSubcircuitDefinitions` define exact nonlocal netlist interfaces.
  Each external definition has a stable identity, an ordered list of stable
  terminals, raw formal defaults, interface status and optional block
  presentation. It has no internal Document body.
- `Instance.schematicReference` is the canvas-facing Reference for ordinary
  Instances. Free Ports use their name claim; Formal Ports use
  `CellTerminal.name`; neither displays a
  `P#` reference. `Instance.netlist` contains the separate emitted reference,
  binding, and typed parameter values for emitting Instances. Import source
  order and symbol-mapping registry identity live in
  `Instance.importProvenance`; there is no persisted property bag.
- Hierarchy is an acyclic graph of ordinary Instances whose typed subcircuit
  bindings resolve to child Documents; orphan Cell definitions are allowed.
- Canvas `port` and `port-filled` objects are ordinary Instances with terminal
  `P`; their connectivity is stored only in `Net.terminals` and ordinary
  terminal Route endpoints.
- Base `Net.terminals` is the physical membership authority.
- `Document.connectivityEvidence` records owner-addressable name claims,
  SPICE-source assertions, and explicit Base-Net equivalence. The shared
  Logical-Net resolver is the sole runtime naming/source authority.
- Route endpoints are terminal or Junction references only.
- A marker claim may classify its Logical Net as `vdd` or `ground`; role never
  substitutes for name identity.
- A named Power Rail uses an ordinary Base Net, Route/Junction geometry, the
  same global name claim as a VDD marker, and a bound RichText annotation.
- Every visible editable label is a RichText annotation. Its binding separates
  `instance-designator`, `instance-schematic-name`, `instance-master-name`,
  `instance-value`, and `cell-terminal-name`. The default ordinary label is
  `instance-schematic-name`: it reads RichText `schematicName`, then falls
  back to the internal `schematicReference` or `netlist.reference`.
  `instance-designator` is optional read-only network-ID display. Renderers
  never synthesize instance text from an internal ID. Bound `net-name` and
  `cell-terminal-name` annotations may carry a RichText `formatOverride` only
  when its flattened text equals the semantic Net or terminal name.
- `Document.presentation.cellSymbol` is optional definition-level block intent:
  a minimum body size and stable formal-terminal side/offset placements.
  Symbol geometry remains derived and caller Instances never persist a copy.
- MOS assets are canonical `nmos`/`pmos`; visual variant selection does not
  change persisted terminal connectivity.

## Read and write

```text
read text -> parse JSON -> require Project schema 21 or 22
-> direct v21-to-v22 upgrade when needed -> strict schema-22 validation -> open
save -> strict validation -> canonical key ordering -> atomic write
```

An invalid candidate never replaces the current browser Project. File Resource
staging is non-mutating; a staged Project can replace the live Project only
after explicit human approval in the editor.

A migrated formal file is marked as needing save. The editor does not silently
overwrite the source selected through the browser file input. Browser recovery
records may be canonicalized to v22 only after a successful validated write.

Project entry does not repair duplicate canonical supply Nets (`0` or `VDD`).
Duplicate folded Net names are invalid input and remain a blocking diagnostic
until the author explicitly renames or merges the Nets.

Canonical serialization ends with one newline and is byte-stable across
save/load/save. The current corpus is listed in
`fixtures/projects/compatibility-corpus.json`; its accepted entries must all be
already canonical Project schema 22. The rejected corpus names expected
validation failures.

Viewport, selection, undo history, canvas overlays, Agent credentials,
recovery envelopes, generated renders, and derived diagnostics are not part of
the Project file.
