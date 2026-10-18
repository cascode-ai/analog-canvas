# Project File Format

Status: `accepted`

Portable file schema: `72`; normalized editor model schema: `58`.

Primary owner: `packages/project-protocol` (portable source and codec);
`packages/model` validates the decoded editor model.

An `.icproj.json` file holds one complete Project. [The loader](../../packages/project-protocol/src/load.ts)
and its transforms/tests own each migration step; this spec owns the current
shape and the boundary. The [schematic model](schematic-model.md),
[connectivity](connectivity-and-routing.md), [netlist export](netlist-export.md)
and [simulation](simulation.md#authored-authority) own the semantics the codec
preserves.

## Read and write

```text
import text -> parse JSON -> require Project file schema 24 through 72
-> migrate old files or decode 59–72 -> strict runtime model validation -> install unbound
export -> validate -> encode file schema 72 -> readable canonical JSON -> download
```

- `parseProject` reads schemas 24–72; writers always emit 72. Envelope
  metadata uses `CURRENT_PROJECT_FILE_VERSION`, never the model version.
  Optional additions keep model 58; older envelopes cannot carry them.
- The reader rejects mixed legacy/current field names, conflicting endpoints,
  unknown fields and missing used component definitions; it never deletes
  unplaced or overlapping instances. An invalid candidate never replaces the
  live Project; File Resource staging needs explicit human approval.
- Adapters preserve intent or report a located incompatibility, never guess
  electrical meaning: ownerless Net-equivalence records are rejected,
  imported spelling becomes non-electrical provenance, old simulation setups
  become source folders. Every load also returns a part drawn as a built-in
  ideal device but bound to a reviewed PDK device whose pins its symbol lacks
  (the variable capacitor bound to the SKY130 varactor) to that ideal device,
  dropping binding, parameters and memberships at the missing pins, keeping
  wires, labels and any authored `value`.
- Entry never physically merges Base Nets; equal authoritative names resolve
  as one Logical Net, conflicts block; repeated source-name hints never
  connect. Only explicit portable-file and Gallery imports may canonicalize
  legacy Wire geometry (incl. removing an unowned Route that resolves to an
  existing endpoint contact); parsing, Cloud open and recovery stay exact.
- Canonical serialization ends with one newline and is byte-stable across
  serialize/parse/serialize. `fixtures/projects/compatibility-corpus.json`:
  `current` entries are already canonical 72; `migrated` witnesses keep source
  bytes and version and load/save byte-stable; the rejected corpus names
  expected failures.
- A migrated imported file is dirty; the browser-selected source is never
  overwritten. Recovery records may be canonicalized only after a validated
  write. Project Code, export, Agent replacement, Cloud Save and recovery share
  the one reader/writer; a full source edit is one undoable commit.
- Not in the file: viewport, selection, undo, overlays, Agent credentials,
  recovery envelopes, renders, derived diagnostics.
- Windows desktop also accepts `.icproj` as a filename alias for the same JSON
  with an opt-in association (`.json` is never taken over); library files and
  exports stay `.icproj.json`.

## Compatibility floor

The floor bounds maintained adapters; it is not a rolling window. Raising it
needs evidence the retired versions were never distributed, or a verified
store inventory plus a conversion path and period; schema velocity is no
reason. When unsure, keep adapters. No load or save bulk-converts Gallery,
Cloud or recovery data.

## Instances and labels

- `instances` hold complete devices: `type` (included class), `name` (authored
  reference), stable `id`, `coordinate` `[x, y]` or `null` (unplaced),
  `rotation`, `mirror`, `color`, optional `backgroundColor`, `parameters`,
  `target`; provenance, body policy, variants and formulas stay on the
  instance. Decoding maps `reference`↔`name`, `symbolId`↔`type`,
  `placement`↔`coordinate`/`rotation`/`mirror`, `netlist`↔`parameters`/`target`.
- Attached labels live in the instance's `labels` with `bind: "name"`,
  `"value"` or `{ "parameter": "w" }` and owner-relative anchors
  `{ offset, fallback }`; cross-object, free and route anchors stay explicit;
  conversion never guesses a binding from attachment. `showValue: false` draws
  only the parameter label. `text`/`format` take strings or full RichText.
  Every label keeps `order`, IDs, visibility, colors, rotations and fallbacks.
  Independent labels stay in `Document.annotations`.
- Symbol body text: `signalFlowParameters.formula`, and from 62
  `formulaFormat` (author RichText); without it the Symbol's look reads the
  compact syntax (`z^-1`, `g_m`).
- `defaults.instance` (rotation, mirror) and `defaults.label` (alignment,
  rotation, lock) are explicit in the file; changing one updates inheriting
  objects; no dependence on website defaults. Absent instance color inherits
  the Document style; `color: "auto"` is an explicit empty override.
  `defaults.instancesByType` holds whole shared values (instance overrides
  replace whole values). RichText runs use strings with ordered `styles`;
  primitive points are pairs. Shortcuts expand to the same complete model.
- 64: optional `documentStyle` on instances, labels, annotations, Routes,
  Junctions, No Connects and drafting; same factors as
  `presentation.styleOverrides`, replacing them for that object (missing = 1);
  copy writes it when source and target defaults differ.
- 65: optional instance `control` (voltage: ±Base-Net IDs; legacy current:
  sensor ID; terminal current: instance, pin, direction), decoded to
  `netlist.control`, per instance; absent controls are never reconstructed
  from formulas.
- 70: optional Document `inductorCouplings`
  `{ id, name, members: [{ instanceId, dotPin } ×2], k, arrow? }` (two distinct
  drawn inductors, `k` is SPICE text, `arrow: false` hides the arrow; no pair
  twice; names unique case-insensitively); omitted when empty so uncoupled
  files keep their bytes.

- 71: optional `draft.authoring[].artworkInitialized` distinguishes untouched
  Automatic artwork from deliberately empty Custom JSON. Earlier envelopes
  cannot carry the field; older drafts infer initialization from Custom mode
  or non-empty artwork text.
- 72: optional `presentation.textFace: "serif"` sets every text of the
  Document, and its exports, in Liberation Serif instead of Metropolis; absent
  means Metropolis, so other files keep their bytes.

## One connection source

- Routes hold only endpoints and geometry, never `netId`; Junctions hold
  geometry only. `nets` is an identity/metadata directory:
  `{ "id": "signal", "at": { "terminal": ["M1", "D"] } }` names the component
  containing that anchor and cannot join disconnected wires; `at: null` for an
  empty metadata-only Net.
- `connections.contacts`: explicit endpoint contacts outside the route graph,
  conducting only while coincident. `connections.unrouted`: intentional links
  without wires (arrays of terminal/junction endpoints). Interior crossings
  never connect. Labels, Cell terminals and power claims keep their logical
  semantics; text placement never rewires.
- Components are computed after all wire facts; runtime `nets.terminals` and
  route/junction `netId` are derived, never editable. Splits allocate unused
  IDs; merges retarget metadata. Terminal-array order is canonical.
- Endpoints: `{ "terminal": ["M1", "D"] }` or `{ "junction": "J1" }`. A
  straight route has `start`, `end`, `legId`; a multi-leg route has `start`
  and `legs` (bends with `id`, `bend`, `coordinate`, optional `mode`); never
  mixed. `defaults.routeLeg.mode` is explicit. All IDs, leg order and modes
  survive conversion.

## Included component definitions

- `componentDefinitions` saves each referenced class once (complete geometry,
  pins, variants, formula presentation, primitive or black-box contract);
  `Instance.type` and drafting `floating-symbol.symbolId` reference them. An
  included definition beats the built-in library; editing it changes every
  instance of the class (copy to a new `symbol.id` to customize some).
- Serialization collects references across all Documents and removes only
  unused classes, never content. Undo keeps deleted classes; a fresh insert
  after the last use takes the current built-in. Old Projects without
  definitions capture the library on entry/save (unsaved past artwork is not
  recoverable). A supplied collection missing a referenced class or variant is
  an error. Definitions are data, not scripts.
- Generated hierarchical artwork carries `generatedFrom`; stable interfaces
  keep captured artwork, intentional interface or presentation edits
  regenerate it.
- Source-backed classes keep `circuitBinding` with raw Symbol JSON (no copy of
  target, order or defaults); their rules, Apply and legacy repair are in
  [Symbol DSL](symbol-dsl.md#source-backed-custom-artwork). Canvas transforms
  never rewrite a shared class; pin-coordinate changes never rename or
  reorder pins; internals are authored only through Project Code or the
  definition workspace.

## Owned model sources

Optional fields by first schema (older envelopes cannot carry them):

| Schema | Field                                                                                                                       |
| ------ | --------------------------------------------------------------------------------------------------------------------------- |
| 63     | `source.files[].content`/`originalContent`, Document `importReference` (source Net names and immutable terminal membership) |
| 66     | Project `modelSources`, external-definition `implementation` binding or placeholder                                         |
| 67     | `spectre` sources, draft `language` (absent inherits the applied one)                                                       |
| 68     | `draft.authoring` per owner, `componentAuthoringDrafts` (library snapshots at a fixed revision)                             |
| 69     | `componentDefinitions[].libraryOrigin` ([publication](component-publication.md))                                            |

- `importReference` is never guessed for older files; source text is kept by
  private saves and backups, omitted from Gallery, and never a netlist export
  authority; `source.files` stays a separate import archive.
- Parsed headers must agree with interface projections. Drafts and authoring
  snapshots are never applied implementations, public packages or drawing
  content. Origin is a hint, never electrical or permission authority;
  rollback keeps a schema-69 reader.
- Owned sources and drafts travel through Cloud Save, recovery, Project Code,
  export, Cell import and copy; loading never promotes legacy declarations;
  copy reuse compares files, drafts and pins and refuses conflicts.

## Offline and Gallery migration

- `scripts/convert-project-format.mjs` converts a Project or Gallery backup
  offline into a new directory, comparing decoded model, rendered SVG and
  netlist analysis and checking idempotence; electrical errors stay errors;
  any failure yields a located report and no applyable backup. Gallery rows
  change only `project_text` and `schema_version`.
- Online migration (`scripts/prepare-gallery-format-migration.mjs`, output
  kept outside Git, backups refreshed first) uses admin-only same-origin
  `POST /api/gallery/maintenance/project-format`
  `{table, id, originalProjectText, projectText}` for `galleryEntries` or
  `galleryEntryVersions`: literal original comparison, re-run conversion, 409
  on a concurrent edit, idempotent, never Cloud Projects. Read back every row
  before declaring done; a Worker rollback does not undo writes.
- `GET /api/gallery/maintenance/schema-backup` needs `table` (`inventory`,
  `galleryEntries`, `galleryEntryVersions`, `galleryLikes`, `cloudProjects`,
  `cloudProjectVersions`) and optional opaque `after`, one raw row per page.
  The store has outgrown the 100 MB `schema-restore` request: roll back via
  [point-in-time recovery](../deployment.md#point-in-time-recovery) (30 days)
  or row by row. Gallery-only backups (`analog-canvas-gallery-backup-v2`, no
  Cloud Projects) never go to the full-store `schema-restore`.
