# Project File Format

Status: `accepted`

Current Project schema: `33`

Primary owners: `packages/model` (current shape) and
`packages/project-protocol` (file boundary)

An `.icproj.json` file is canonical JSON for one complete `CircuitProject`.
`@icm/project-protocol` exposes `parseProject`. The file boundary accepts every
schema covered by its explicit 24→33 upgrade chain. Schema 32 added optional
presentation-only `Annotation.textColor`; schema 33 removes ownerless
`explicit-equivalence` connectivity. The 32→33 adapter advances the version
stamp only when that retired record is absent. If one exists, it rejects at the
exact evidence path rather than silently dropping connectivity, merging Base
Nets, or inventing a name. The public file boundary supplies only schema 33 in
memory and writes only schema 33; versions older than 24 or newer than 33 are
rejected.

## Current authorities

- `Document.netlist.terminals` defines ordered authored Cell-Pin declarations
  with stable identity, direction, Net binding, and exactly one ordinary Cell
  Pin Instance. Equal names remain independent; formal consumers group them by
  case-insensitive name without changing the Project.
- `Document.netlist.formalParameters` and project-level
  `externalSubcircuitDefinitions` define exact nonlocal netlist interfaces.
  Each external definition has a stable identity, an ordered list of stable
  terminals, raw formal defaults, interface status and optional block
  presentation. It has no internal Document body.
- `Instance.schematicReference` is the canvas-facing Reference for ordinary
  Instances. Cell Pins use `CellTerminal.name` and never display a `P#`
  reference. `Instance.netlist` contains the separate emitted reference,
  binding, and typed parameter values for emitting Instances. Import source
  order and symbol-mapping registry identity live in
  `Instance.importProvenance`; there is no persisted property bag.
  `Instance.signalFlowParameters` stores optional schematic-only formula data
  plus 10-unit-grid minimum frame dimensions. The dimensions are presentation
  lower bounds, not fixed geometry: the renderer expands the frame to preserve
  the shared 12-unit formula size and content padding. The metadata remains
  independent from emitted netlist parameters.
- Hierarchy is an acyclic graph of ordinary Instances whose typed subcircuit
  bindings resolve to child Documents; orphan Cell definitions are allowed.
- Canvas `port` and `port-filled` objects are Cell Pin marker Instances
  with terminal `P`; their connectivity is stored in `Net.terminals` and
  ordinary terminal Route endpoints.
- Base `Net.terminals` is the physical membership authority.
- `Document.connectivityEvidence` records typed name claims and SPICE-source
  assertions for one Base Net at a time. The shared Logical-Net resolver is the
  sole runtime naming/source authority and joins distinct Base Nets only through
  matching folded names in the same scope.
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
  never synthesize instance text from an internal ID. `Annotation.textColor`
  is an independent presentation override; when absent, instance reference and
  value annotations inherit their owning Instance foreground, while other
  annotations inherit the Document foreground. Bound `net-name` and
  `cell-terminal-name` annotations may carry a RichText `formatOverride` only
  when its flattened text equals the semantic Net or terminal name.
- A RichText document is either ordinary styled text runs or one atomic
  formula run containing bounded LaTeX source and `inline`/`block` display
  intent. Typeset SVG paths and metrics are derived artifacts, never Project
  content.
- `Document.presentation.cellSymbol` is optional definition-level block intent:
  a minimum body size and stable formal-terminal side/offset placements.
  Symbol geometry remains derived and caller Instances never persist a copy.
- MOS assets are canonical `nmos`/`pmos`; visual variant selection does not
  change persisted terminal connectivity.

## Read and write

```text
import text -> parse JSON -> require Project schema 24 through 33
-> converge to schema 33 -> strict schema-33 validation -> install unbound
export -> strict validation -> canonical key ordering -> Blob download
```

An invalid candidate never replaces the current browser Project. File Resource
staging is non-mutating; a staged Project can replace the live Project only
after explicit human approval in the editor.

A migrated imported file is marked dirty. The editor never overwrites a source
selected through the browser file input; the user may Save it as a Cloud
Project or explicitly export upgraded bytes. Browser recovery records may be
canonicalized to v33 only after a successful validated write.

Project entry does not repair duplicate canonical supply Nets (`0` or `VDD`).
Duplicate folded Net names are invalid input and remain a blocking diagnostic
until the author explicitly renames or merges the Nets.

Canonical serialization ends with one newline and is byte-stable across
serialize/parse/serialize. The current corpus is listed in
`fixtures/projects/compatibility-corpus.json`; its accepted entries must all be
already canonical Project schema 33. The rejected corpus names expected
validation failures.

Viewport, selection, undo history, canvas overlays, Agent credentials,
recovery envelopes, generated renders, and derived diagnostics are not part of
the Project file.
