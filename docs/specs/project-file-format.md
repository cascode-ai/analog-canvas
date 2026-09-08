# Project File Format

Status: `accepted`

Current Project schema: `47`

Primary owners: `packages/model` (current shape) and
`packages/project-protocol` (file boundary)

An `.icproj.json` file is canonical JSON for one complete `CircuitProject`.
`@icm/project-protocol` exposes `parseProject`. The file boundary accepts every
schema covered by its explicit 24→47 upgrade chain. Schema 32 added optional
presentation-only `Annotation.textColor`; schema 33 removes ownerless
`explicit-equivalence` connectivity. The 32→33 adapter advances the version
stamp only when that retired record is absent. If one exists, it rejects at the
exact evidence path rather than silently dropping connectivity, merging Base
Nets, or inventing a name. Schema 34 retires hidden
`explicit-net-property` claims: the 33→34 adapter preserves imported ordinary
spellings as non-electrical `net-name-hint` provenance, retains explicit SPICE
globals as owned global declarations, and materializes an existing visible
power owner when possible. Schema 35 unifies canvas and emitted Instance
References: the 34→35 adapter moves one selected value to
`Instance.reference`, materializes distinct descriptive RichText as an
attached literal Annotation, converts ordinary default labels to
`instance-reference`, and removes fabricated marker references. Schema 36
repairs reference-shaped labels that schema 35 accidentally materialized as
literal text and preserves their RichText as a mapped same-text presentation.
Schema 37 adds the optional Project `simulation` field: one persisted
`SimulationSetup` (ADR 0055) naming the Testbench root Cell, the analyses, the
probes, and the environment Profile selection. Results and run data never
enter the file. An absent field means no authored setup, which is every
existing Project, so the 36→37 adapter rewrites nothing. Schema 38 adds
structured TRAN with explicit seconds-valued step, stop, optional start, and
optional maximum-step fields. Existing setups remain valid, so the 37→38
adapter also rewrites nothing. Schema 39 adds the raw `SimulationSetup` branch:
a safe relative entry, small authored text files, external dependency identity,
and environment selection. The 38→39 adapter invents no setup. Schema 40
replaces derived voltage-probe Net representatives with concrete Terminal,
Junction, or Route anchors. The 39→40 adapter chooses an existing attached
object deterministically and retains a Base-Net fallback only when no attached
object exists, so migration never silently drops an authored probe. A deleted
anchor or Testbench Cell may leave a saved setup unresolved; preparation owns
the located, recoverable diagnostic. Schema 41 adds a structured, single-source
linear DC sweep analysis; existing setups remain valid, so the 40→41 adapter
rewrites no authored content. Schema 42 replaces the optional singleton with a
named `simulationSetups` collection; the 41→42 adapter preserves one authored
setup with a deterministic ID/name and maps absence to an empty collection.
Schema 43 replaces primitive probes with named outputs and bounded expression
trees; the 42→43 adapter preserves each target as a leaf output and derives an
initial human-readable label. Schema 44 makes terminal identity explicit for
current expressions; the 43→44 adapter preserves the previously supported
independent-source sign by selecting its `+` terminal. Schema 45 adds optional
saved scalar measurement rules to structured setups;
the 44→45 adapter invents no measurement intent. Schema 46 adds structured
Noise analysis intent with hierarchy-aware output anchors and a Testbench-root
independent input source; the 45→46 adapter invents no analysis. Schema 47
adds optional hierarchy-aware MOS operating-point selections; the 46→47
adapter selects no device implicitly. The public file boundary
supplies only schema 47 in
memory and writes only schema 47; versions older than 24 or newer than 47
are rejected.

## Current authorities

- `Document.netlist.terminals` defines ordered authored Cell-Pin declarations
  with stable identity, direction, Net binding, and exactly one ordinary Cell
  Pin Instance. Equal case-folded names identify one Logical Net without
  physically merging their independently authored Base Nets.
- `Document.netlist.formalParameters` and project-level
  `externalSubcircuitDefinitions` define exact nonlocal netlist interfaces.
  Each external definition has a stable identity, an ordered list of stable
  terminals, raw formal defaults, interface status and optional block
  presentation. It has no internal Document body.
- `Instance.reference` is the sole authored Reference for an ordinary
  referenced Instance and is both displayed and emitted. Its stored prefix is
  the ngspice invocation designator, including `X` for external subcircuit
  calls. Cell Pins use `CellTerminal.name` and never display a `P#` reference.
  `Instance.netlist` contains only binding and typed parameter values for
  emitting Instances.
  Import source
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
- `Document.connectivityEvidence` records owner-addressed name claims, explicit
  imported global declarations, non-electrical source-name hints, and
  SPICE-source assertions for one Base Net at a time. The shared Logical-Net
  resolver joins distinct Base Nets through authoritative scoped names or equal
  formal Cell-Pin names; hints and source identity never create connectivity.
- Route endpoints are terminal or Junction references only.
- A marker claim may classify its Logical Net as `vdd` or `ground`; role never
  substitutes for name identity.
- A named Power Rail uses an ordinary Base Net, Route/Junction geometry, the
  same global name claim as a VDD marker, and a bound RichText annotation.
- Every visible editable label is a RichText annotation. `instance-reference`
  projects only `Instance.reference`; `instance-value`, `net-name`, and
  `cell-terminal-name` project their own typed facts. Other attached labels,
  including visible master descriptions, are literal text without identity or
  export authority. Renderers never synthesize Instance text from an internal
  ID. `Annotation.textColor`
  is an independent presentation override; when absent, instance reference and
  value annotations inherit their owning Instance foreground, while other
  annotations inherit the Document foreground. Bound `instance-reference`,
  `net-name`, and `cell-terminal-name` annotations may
  carry a RichText `formatOverride` only when its flattened text equals the
  semantic Reference, Net, or terminal name. Reference allocation and rename
  update that same-text projection atomically without discarding its styling.
  Device visual annotations customized on the canvas use literal `content`
  instead, on the same Annotation ID and anchor, without `binding` or
  `formatOverride`. They do not rename or duplicate `Instance.reference`.
  Save/open and copy preserve this exclusive choice; only explicit **Use
  netlist name** returns a custom annotation to following. The JSON field
  remains `Instance.reference` (UI: **Netlist Reference**), with no schema bump.
- A RichText document is either ordinary styled text runs or one atomic
  formula run containing bounded LaTeX source and `inline`/`block` display
  intent. Typeset SVG paths and metrics are derived artifacts, never Project
  content.
- `Document.presentation.cellSymbol` is optional definition-level block intent:
  a minimum body size and stable formal-terminal side/offset placements.
  Symbol geometry remains derived and caller Instances never persist a copy.
- MOS assets are canonical `nmos`/`pmos`; visual variant selection does not
  change persisted terminal connectivity.
- `Project.simulationSetups` is the named setup collection defined in the
  [simulation spec](simulation.md#persistence-and-compatibility). Each record
  has stable `id`, editable unique `name`, and a `version: 2` envelope around
  exactly one structured or raw input. A
  structured root must name a Document of the Project, analyses hold at most
  one entry per kind, and output ids and labels are unique. Each output owns
  one bounded expression over voltage/current acquisitions and constants;
  `output.label` is the sole authored name used by OP/DC/AC/TRAN results,
  plots, CSV, and MCP. Optional measurement rules reference one enabled
  analysis and one Output and persist a scalar reduction, never a Run result.
  Selected MOS operating-point details name concrete hierarchy occurrences;
  the compiler derives VGS/VDS/VBS and drain-entering ID from terminal and Bulk
  connectivity without persisting simulator vectors. Noise owns a differential voltage target and root independent input source;
  its two density curves use stable protocol output ids instead of duplicating
  ordinary Output expressions.
  A raw input owns bounded author
  files in the shared virtual relative namespace and declares external bytes
  by logical identity, mount path, and digest; it never stores a host path. Both
  forms store only a Profile ID plus the author's corner and temperature
  selections. Source stimulus values
  (`dc`, `acMagnitude`, `acPhase`) are typed netlist parameters of the source
  Instances, never a copy inside the setup.

## Read and write

```text
import text -> parse JSON -> require Project schema 24 through 47
-> converge to schema 47 -> strict schema-47 validation -> install unbound
export -> strict validation -> canonical key ordering -> Blob download
```

An invalid candidate never replaces the current browser Project. File Resource
staging is non-mutating; a staged Project can replace the live Project only
after explicit human approval in the editor.

A migrated imported file is marked dirty. The editor never overwrites a source
selected through the browser file input; the user may Save it as a Cloud
Project or explicitly export upgraded bytes. Browser recovery records may be
canonicalized to the current schema only after a successful validated write.

Project entry does not physically merge Base Nets. Matching authoritative names
resolve as one Logical Net; conflicting claims remain a blocking diagnostic.
Repeated source-name hints are valid provenance and never imply connectivity.
The explicit portable-file and Gallery import boundaries may canonicalize
legacy ordinary-Wire geometry, including removal of an unowned Route that now
resolves entirely to an already-connected endpoint contact; parsing, Cloud
open, and recovery remain exact.

Canonical serialization ends with one newline and is byte-stable across
serialize/parse/serialize. The current corpus is listed in
`fixtures/projects/compatibility-corpus.json`; its accepted entries must all be
already canonical Project schema 47. The rejected corpus names expected
validation failures.

Viewport, selection, undo history, canvas overlays, Agent credentials,
recovery envelopes, generated renders, and derived diagnostics are not part of
the Project file.
