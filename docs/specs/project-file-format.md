# Project File Format

Status: `accepted`

Project schema: `58`

Primary owners: `packages/model` (current shape) and
`packages/project-protocol` (file boundary)

An `.icproj.json` file is canonical JSON for one complete `CircuitProject`.
The current-only model validates schema 58. The public `parseProject` boundary
accepts schemas 24 through 58, runs the explicit contiguous upgrade chain, and
returns only the current shape. Serialization writes only schema 58.
Versions outside that range are rejected.

## Included component definitions

Schema 58 saves each referenced Symbol once in `componentDefinitions`.
`Instance.symbolId` and drafting `floating-symbol.symbolId` reference these
local classes. Each class contains the complete Symbol geometry, pins,
variants, formula presentation, and its primitive electrical or black-box
subcircuit contract when applicable. Instance parameters and placement remain
on the Instance. An included definition takes precedence over the website's
built-in library. Editing its geometry updates every instance of that class;
copy the class to a new `symbol.id` (and matching electrical `symbolId`) and
change selected instances' `symbolId` to customize only those instances.

Custom component internals are authored through Project Code, not through
mouse-drawn shapes or a separate graphical component editor. Canvas transforms
edit Instance placement and never rewrite a shared class. Component definition
changes use the existing validated, undoable Project commit. Future graphical
definition editing must write this same representation rather than introduce
a second geometry authority. Visual pin-coordinate changes do not implicitly
rename pins or reorder the electrical interface.

Serialization collects references across **all** Project Documents and removes
only unused classes. It never deletes a Document, Instance, parameter, or
setting to shorten the code. Editor undo retains deleted classes with its
history snapshots. Deleting the last use removes the live class; a later fresh
library insertion uses the current built-in definition.

Generated hierarchical artwork also carries its small `generatedFrom` input
record. Stable Cell interfaces preserve captured artwork; an intentional
interface or Cell-symbol presentation edit regenerates that class. These
records are ordinary source data, with no content-hash checks.

Older Projects without included definitions remain readable and capture the
available library on entry/save. They cannot recover artwork from an earlier
website version that was never stored. When a file supplies a definition
collection, missing referenced classes or variants are an error rather than a
silent fallback. Custom definitions must follow the supported primitive and
electrical schemas; they are data, not executable scripts or model libraries.

[The loader](../../packages/project-protocol/src/load.ts) and its adjacent
transforms/tests own individual migration steps. Adapters preserve authored
intent or produce a located incompatibility; they cannot guess replacement
electrical meaning. In particular, ownerless Net-equivalence records are
rejected, imported spelling becomes non-electrical provenance, and old simulation
setups become source folders. A failed import leaves the live Project unchanged.
Compatibility does not create legacy runtime writers or authorize bulk rewriting
of stored Gallery or Cloud data.

## Compatibility floor

The supported floor bounds maintained adapters; it is not a rolling expiry
window. Raising it is a deliberate contract change requiring evidence that the
retired versions were never distributed, or a verified store inventory plus an
available conversion path and an adequate conversion period. Schema velocity
and chain length alone do not justify refusing existing user files. Where the
evidence is uncertain, retain the adapters. No load or ordinary save performs
an unsolicited bulk conversion of Gallery, Cloud or recovery data.

## Current authorities

- `Document.netlist.terminals` defines ordered authored Cell-Pin declarations
  with stable identity, direction, Net binding, and exactly one interface owner:
  either an ordinary Cell Pin Instance or a visible Power Rail annotation. Equal
  case-folded names identify one Logical Net without
  physically merging their independently authored Base Nets.
- `Document.netlist.formalParameters` and project-level
  `externalSubcircuitDefinitions` define exact nonlocal netlist interfaces.
  Each external definition has a stable identity, an ordered list of stable
  terminals, raw formal defaults, interface status and optional block
  presentation. It has no internal Document body.
- `Instance.reference` is the sole authored Reference for an ordinary
  referenced Instance and is displayed by default. Process/model selection
  preserves it. SPICE extraction adds the required invocation prefix when
  needed (for example, `M1` becomes `XM1` for a PDK subcircuit); Spectre
  preserves the authored name. Derived names reserve existing legal names and
  add a numeric suffix on collision. Export and simulation share this mapping;
  code-editor renames edit the authored portion. Imported `X` references remain
  valid through model transitions. Cell Pins use `CellTerminal.name` and never
  display a `P#` reference.
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
- Canvas `port` and `port-filled` objects are Cell Pin marker Instances with
  terminal `P`. A `vdd-port` Instance may use the same formal-terminal protocol
  or, mutually exclusively, own a Global VDD name claim. Their connectivity is
  stored in `Net.terminals` and ordinary terminal Route endpoints.
- Base `Net.terminals` is the physical membership authority.
- `Document.connectivityEvidence` records owner-addressed name claims, explicit
  imported global declarations, non-electrical source-name hints, and
  SPICE-source assertions for one Base Net at a time. The shared Logical-Net
  resolver joins distinct Base Nets through authoritative scoped names or equal
  formal Cell-Pin names; hints and source identity never create connectivity.
- Route endpoints are terminal or Junction references only.
- A marker claim may classify its Logical Net as `vdd` or `ground`; role never
  substitutes for name identity.
- A named Power Rail uses an ordinary Base Net, Route/Junction geometry, a
  local VDD name claim by default, and a bound RichText annotation that owns a
  formal Cell terminal. An explicitly Global Rail has no formal terminal.
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
  Save/open and copy preserve this exclusive choice; clearing **Use display
  alias** returns a custom annotation to following. The JSON field
  remains `Instance.reference` (UI: **Netlist Reference**), with no schema bump.
- A RichText document is either ordinary styled text runs or one atomic
  formula run containing bounded LaTeX source and `inline`/`block` display
  intent. Typeset SVG paths and metrics are derived artifacts, never Project
  content.
- `Document.presentation.cellSymbol` is optional definition-level block intent:
  a minimum body size and stable formal-terminal side/offset placements.
  The shared generated class is included in `componentDefinitions`; its source
  interface and presentation record determine when to regenerate the artwork.
  Caller Instances reference that class rather than persisting their own copy.
- MOS assets are canonical `nmos`/`pmos`; visual variant selection does not
  change persisted terminal connectivity.
- `Project.simulationFolders` is the named version-4 source collection defined
  in [simulation](simulation.md#authored-authority). A folder owns source files,
  entry/config paths, optional generated Cell bindings, declared dependencies
  and unapplied drafts. Generated circuit bytes and results are not persisted.
  New experiments use minimal version-2 configuration; version-1 sidecars remain
  an explicit compatibility path. Project schema, folder envelope version and
  configuration version are distinct contracts.

## Read and write

```text
import text -> parse JSON -> require Project schema 24 through 58
-> converge to schema 58 -> strict schema-58 validation -> install unbound
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
`fixtures/projects/compatibility-corpus.json`; its `current` entries must all be
already canonical Project schema 58. Explicit `migrated` witnesses retain their
source bytes and declared source version; loading and saving must produce a
byte-stable current Project. The rejected corpus names expected validation
failures. These are test inventory categories, not new Project fields.

Viewport, selection, undo history, canvas overlays, Agent credentials,
recovery envelopes, generated renders, and derived diagnostics are not part of
the Project file.
