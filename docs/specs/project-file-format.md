# Project File Format

Status: `accepted`

Portable file schema: `68`; normalized editor model schema: `58`.

Primary owner: `packages/project-protocol` (portable source and codec).
`packages/model` validates the normalized editor indexes used by rendering,
connectivity and transactions. The normalized indexes are decoded working data;
serialization always writes the one schema-68 authoring representation.

An `.icproj.json` file contains a complete Project. The public `parseProject`
boundary reads file schemas 24 through 68. Historical schemas pass through the
existing explicit upgrades; schemas 59 through 68 decode through the
owned-object codec. Schema 60 introduced derived network membership from
connection facts. Schema 62 lets a Symbol's body text keep an authored look. Both return the same validated editor model. File/envelope
metadata must use `CURRENT_PROJECT_FILE_VERSION`, not the internal model
version.

Windows desktop also accepts `.icproj` as an outer filename alias for exactly
the same canonical JSON. It allows an opt-in product-specific file association:
Windows treats `.icproj.json` as `.json`, which this application never takes over.
Library files and portable exports continue to use `.icproj.json`; external
desktop Save As suggests `.icproj`. There is no second codec, schema or model.

Schema 63 adds optional `source.files[].content` (decoded text and encoding),
`originalContent` for inputs converted before parsing, and Document
`importReference`. The reference stores source Net names/scopes and immutable
terminal membership: instance ID plus source terminal position, or a formal
Port's pin name. Current device `terminalMapping` resolves positions after
symbol pin remapping. Reference file IDs keep the input archive with Cell copies.
Missing instances remain missing reference members; merge/split never rewrite
this topology. Older projects do not acquire a guessed reference during loading.
Source text is retained by private saves/portable backups, omitted from Gallery
publication, and never used as the current netlist export authority.

Schema 64 adds optional `documentStyle` to instances, their labels, free
annotations, Routes, Junctions, No Connect marks and drafting objects. It holds
the same factors as the Document's `presentation.styleOverrides` and replaces
them for that object alone; a factor left out means 1. Copy writes it when the
source and target style defaults differ, so the copy draws like its source
([interaction](editor-interaction.md)). An object without it follows its
Document. Files of schema 63 and earlier cannot carry it.

## Instance-owned source

Schema 66 adds optional Project `modelSources` and external-definition
`implementation` bindings. A native SPICE owner retains exact relative-file
text, its entry path, pinned dependency identities/digests, applied revision and
optional saved draft. A source binding selects one parsed subcircuit entry;
an explicit placeholder has no applied implementation and may retain a draft
owner. Parsed headers must agree with persisted interface projections. Earlier
file versions cannot carry these fields. The editor model stays at 58 because
these are optional additions.

Schema 67 adds native `spectre` model sources and optional draft `language`.
Schema 66 SPICE owners load unchanged, with an absent draft language inheriting
the applied language. Earlier envelopes cannot carry the new language facts;
current portable writers emit 68. Conversion never changes the native owner
unless committed through the ordinary Apply boundary.

Schema 68 adds optional source `draft.authoring` candidates, keyed by native
owner, and Project `componentAuthoringDrafts` for unfinished primitive/artwork
text and isolated public-library authoring snapshots. A library draft retains
its public record identity/revision and an encoded private snapshot; reopening
uses that fixed baseline, with public permissions and revision checks enforced
by the library service. It never installs snapshot owners into the drawing.
They retain raw text, mapping, selected entry, mode, layout and directions;
a last-valid artwork cache is preview-only. Copy provenance remaps identities
when raw JSON still names its original owner, without rewriting invalid text.
Saved legacy repair candidates retain the original capture baseline and explicit
scope/disconnection choices. None of these fields is an applied implementation,
a public package or a used runtime component. Earlier envelopes cannot carry
these fields. These optional fields retain runtime schema 58; existing files keep their
applied facts.

Owned sources and drafts travel through Cloud Save, recovery, Project Code,
portable export/reload, Cell import and cross-Project copy. Import provenance
`source.files` remains a separate archive. Legacy declarations and
simulation-folder bodies are retained; loading does not guess or promote their
implementation. Compatible copy reuse compares native files, drafts and pinned
dependencies; conflicting implementations refuse without selecting a substitute.

Schema 65 preserves an instance's optional `control`, independently of its
visual annotation: voltage controls retain positive/negative Base-Net IDs,
legacy current controls retain the sensor instance ID, and terminal-current
controls retain instance ID, pin name and direction. It decodes to
`netlist.control`; incomplete authored selections remain incomplete. Controls
are per-instance, never shared type defaults. Earlier portable writers omitted
this field: absent controls cannot be reconstructed from visual formulas.

A Document's `instances` array contains complete device objects. `type` names
an included component class, `name` is the authored netlist reference, and `id`
is stable identity. `coordinate` is `[x, y]` or `null` for an unplaced instance;
`rotation`, `mirror`, `color` and optional `backgroundColor` describe placement
and paint. `parameters` and `target` hold netlist values and binding. Provenance,
body connection policy, variants and schematic formulas remain on the instance.

Attached name, value, parameter and literal labels live in that same instance's
`labels` array. A label's `bind: "name"`, `bind: "value"`, or
`bind: { "parameter": "w" }` inherits its instance identity, eliminating repeated
owner IDs. An anchor `{ "offset": [25, 0], "fallback": [225, 200] }` likewise
inherits that owner. Unusual cross-object, free and route anchors stay explicit;
conversion never guesses that a visual attachment changes a text binding.
Named parameter bindings may set `"showValue": false` to draw only the live
parameter label while retaining the electrical value. Omitting it draws the
usual `label = value` presentation.
A Symbol's body text lives in the instance's `signalFlowParameters`: `formula`
holds its characters and, from schema 62, `formulaFormat` holds the author's
RichText look for them (slant, weight, scripts, overbars, fractions, formulas).
Without `formulaFormat` the text draws in the Symbol's own look, reading
`formula`'s compact syntax (`z^-1`, `g_m`, `1/(1-z)`) as before.
Literal `text` and formatting `format` accept plain strings or complete RichText
objects, retaining fractions, formulas, spans and line breaks. Every label has
an `order` preserving the original annotation sequence across owned and free
labels. IDs, visibility, colors, rotations and fallback positions are retained.
Independent labels remain in `Document.annotations`.

The file owns its `defaults.instance` (rotation and mirror) and `defaults.label`
(alignment, rotation and lock) values. Missing per-object fields inherit these
explicit values; they do not depend on mutable website defaults. Changing a
file default updates inheriting objects. The writer canonicalizes equivalent
inheritance without discarding resulting values. Absence of instance color
inherits the Document style; `color: "auto"` records an explicit empty paint
override. Empty label collections may be omitted.

## One connection source

Routes contain only endpoint references and geometry; they never contain a
`netId`. Junctions contain geometry without network membership. `nets` is an
identity/metadata directory: `{ "id": "signal", "at": { "terminal": ["M1", "D"] } }`
keeps a stable name for the connected component containing that anchor. It
cannot join disconnected wires. An empty metadata-only network uses `at: null`.

`connections.contacts` contains explicit endpoint contacts absent from the
route graph. They conduct only while the endpoints remain coincident.
`connections.unrouted` contains intentional links without drawn wires, such as
unrouted imported connections. Each link is an array of terminal/junction
endpoints. Interior wire crossings alone do not imply a connection. Net labels,
Cell terminals and power claims keep their existing explicit logical semantics;
visual text placement never silently rewires a historical label.

The shared connection graph computes connected components after all wire facts
are known. Runtime `nets.terminals` and route/junction `netId` are derived
indexes, never a second editable source. Adding, deleting or repointing routes
in Project Code does not require editing membership. Splits allocate stable
unused IDs; merged identities retarget their metadata. Direct Project Code
commits and Agent/file replacement use this same reader. Runtime terminal-array
order is canonical, not authored information.

Endpoints use `{ "terminal": ["M1", "D"] }` or `{ "junction": "J1" }`.
A single straight route has `start`, `end`, and `legId`. A multi-leg route has
`start` and `legs`; a bend records `id`, `bend`, `coordinate` and optional `mode`.
The two forms cannot be mixed. `defaults.routeLeg.mode` is explicit in the file.
Every route/leg/bend ID, leg order and mode survives conversion.

`defaults.instancesByType` stores complete shared parameter, target, color and
variant values for repeated device classes. Instance overrides replace whole
values without hidden merges. Styled RichText runs use strings and ordered
`styles` arrays instead of one wrapper per style; fractions and formula source
remain explicit. Symbol primitive points use coordinate pairs. All shortcuts
expand to the same complete model, with no external defaults or compressed data.

The reader rejects mixed legacy/current field names, conflicting endpoints,
unknown fields and missing used component definitions. It does not delete
unplaced or overlapping instances. Q still edits the same decoded instance;
Project Code, file export, Agent file replacement, Cloud Save and recovery use
the same public reader/writer. A full source edit remains one undoable commit.

## Offline migration

`node scripts/convert-project-format.mjs INPUT_JSON NEW_OUTPUT_DIRECTORY`
converts an individual Project or a Gallery backup after workspace packages
are built. It never contacts the service or overwrites its input. For every
record it compares the complete decoded model, exact rendered SVG and netlist
analysis before/after, and checks save/load idempotence. Existing electrical
errors remain errors; this is a structural migration, not circuit repair.
Statistics record expanded source/model line counts and the actual editable
output line count, as well as JSON payload bytes. Model equality ignores only
the derived terminal-index ordering. Project Code keeps complete objects in
blocks with descriptive keys; only short property values and coordinate or
terminal pairs stay on one line. It never stores compressed or encoded source.

A Gallery conversion preserves row metadata and cached previews, replacing only
`project_text` and `schema_version`. If any record fails, the command writes a
located report and emits no applyable combined backup. The source backup stays
untouched. Bulk online migration is a separate explicit operation, performed
only after complete backup and compatible readers/writers are available.

Administrator backup supports `GET /api/gallery/maintenance/schema-backup` with
`table=inventory`, or one of `galleryEntries`, `galleryEntryVersions`,
`galleryLikes`, `cloudProjects`, `cloudProjectVersions` and an optional opaque
`after` cursor; a request without `table` is refused. Each page returns at
most one raw row, avoiding Cloudflare's SQL result-set memory limit. A
`schema-restore` payload is assembled from those pages and must fit one Worker
request (100 MB), which the whole store has outgrown; rolling it back is
[point-in-time recovery](../deployment.md#point-in-time-recovery) within 30
days, or a row-by-row restore from an archive.
A Gallery-only backup is `analog-canvas-gallery-backup-v2`: it includes all
statuses, all retained versions and like relationships, excludes private Cloud
Projects and must never be sent to the older full-store `schema-restore` route.
A paginated export records its capture interval rather than claiming a single
atomic database snapshot. Separate local and private remote copies are retained.

## Included component definitions

Schemas 58 through 62 save each referenced Symbol once in `componentDefinitions`.
Portable `Instance.type` (decoded as `Instance.symbolId`) and drafting
`floating-symbol.symbolId` reference these local classes. Each class contains
the complete Symbol geometry, pins,
variants, formula presentation, and its primitive electrical or black-box
subcircuit contract when applicable. Instance parameters and placement remain
on the Instance. An included definition takes precedence over the website's
built-in library. Editing its geometry updates every instance of that class;
copy the class to a new `symbol.id` (and matching electrical `symbolId`) and
change selected instances' `type` to customize only those instances.

Source-backed custom classes instead retain `circuitBinding` alongside the raw
Symbol JSON. The mapping names an external definition and its stable terminal
IDs; it does not duplicate the native target, formal order or defaults. The
external definition's optional preferred `symbolId` is a live authoring use,
so its capture survives save before first placement. Each occurrence otherwise
keeps its chosen captured class. Runtime formal-name projections are derived
and do not replace graphical names in the portable file.

Native Apply creates changed artwork under a new captured ID and may migrate
selected occurrences atomically. Cross-Project copy remaps external owner,
terminal and symbol identities together with the existing owned source closure.
Ordinary partial selection still cuts outside connections and does not turn
graphical labels into parent Net names.

Custom component internals are authored through Project Code or the
code-and-preview definition workspace (E / Edit Component Definition), not
through mouse-drawn shapes. The JSON definition workspace publishes its Save to
the public User Defined library and forks a new class for the selected
instance. Shared library revisions have versioned Symbol IDs; a Project keeps
its embedded definition even if the public entry is updated or removed.
Canvas transforms
edit Instance placement and never rewrite a shared class. Component definition
changes use the existing validated, undoable Project commit. Future graphical
definition editing must write this same representation rather than introduce
a second geometry authority. Visual pin-coordinate changes do not implicitly
rename pins or reorder the electrical interface.

User Components also offers native SPICE/Spectre authoring with automatic or
mapped custom artwork. Its Apply reuses the same `modelSources` owner and
`externalSubcircuitDefinitions` projection as Cell Manager; native declarations
own target, formal terminal order and parameter defaults. An already exposed
owner/entry reuses its stable definition and terminal IDs. Instances own overrides
and ordinary connectivity, while generated artwork remains a checked projection.
This Project Apply is separate from public-library Publish; it does not publish an
interface-only substitute for a native model package. Copy, export and simulation
preparation resolve the applied owner revision, and saved drafts remain separate.

Public Publish carries the applied source's reachable owned files, explicit library
dependency identities/digests, external interface and checked artwork mapping in
a versioned resource envelope beside `definition`. Public native editing uses an
isolated Project snapshot and the same Apply transaction. Library insertion uses
ordinary copy planning to capture these facts as `modelSources`,
`externalSubcircuitDefinitions` and `componentDefinitions`; the occurrence binds
to that Project-owned external definition. No cloud lookup is needed afterward.
Compatible resources can be reused; conflicting bytes, dependencies or mappings
are refused atomically. The library stores one current public record with a
numeric concurrency revision, not a retrievable history. Its updates and deletion
never rewrite the independently saved Project captures.

Explicit User Components repair replaces the selected legacy captured class's
occurrences, or an explicitly selected single occurrence, with a new source-bound
capture. Raw geometry and checked
terminal correspondences remain in `componentDefinitions`; executable bytes
remain in the applied `modelSources` owner selected by
`externalSubcircuitDefinitions`. No decoder body or same-name model is inferred
from the old `subcircuit.target`. Compatible contacts and instance parameters
survive ordinary symbol/binding migration; incompatible connected changes use
native Apply's explicit port migration. Preview and failed/stale repairs change
neither Project nor public record. Project Undo and independent saved files keep
pre-repair legacy evidence; public updates do not rewrite those captures.

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
Every load also returns a part drawn as a built-in ideal device but bound to a
reviewed PDK device whose drawn pins its symbol lacks — a variable capacitor
bound to the SKY130 varactor between 2026-10-01 and #1298, which could be
neither wired nor exported — to that ideal device. The binding, the device's
parameters and its Net memberships at pins the symbol lacks are dropped; wires,
labels and any authored `value` stay, and no value is invented. A stored copy
changes only when it is next saved.
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

## Decoded model authorities

Portable and normalized objects represent the same facts, not independently
editable sources. At the boundary, `Instance.reference` maps to `name`,
`symbolId` to `type`, `placement` to `coordinate`/`rotation`/`mirror`,
and `netlist` to `parameters`/`target`. Attached annotations become instance
`labels` with `bind`, `text` and `format`; the codec preserves authored order
and identity. Runtime membership indexes are derived from the connection facts
described above.

The [schematic model](schematic-model.md) owns Instance, Cell interface, Net,
annotation and presentation semantics. [Connectivity](connectivity-and-routing.md)
owns physical/logical resolution and lifecycle; [netlist export](netlist-export.md)
owns dialect name projection. [Simulation](simulation.md#authored-authority)
owns source folders and their separate envelope/configuration versions. The
file codec preserves these contracts rather than redefining them.

## Read and write

```text
import text -> parse JSON -> require Project file schema 24 through 68
-> migrate old files or decode 59–68 -> strict runtime model validation -> install unbound
export -> validate -> encode file schema 68 -> readable canonical JSON -> download
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
already canonical Project file schema 68. Explicit `migrated` witnesses retain
their source bytes and declared source version; loading and saving must produce
a byte-stable current Project. The rejected corpus names expected validation
failures. These are test inventory categories, not new Project fields.

Viewport, selection, undo history, canvas overlays, Agent credentials,
recovery envelopes, generated renders, and derived diagnostics are not part of
the Project file.

## Bounded Gallery migration

`node scripts/prepare-gallery-format-migration.mjs GALLERY_BACKUP NEW_DIRECTORY`
verifies the Gallery-only backup using the lossless converter and creates one
request file per current/historical row plus the complete expected readback.
Keep this sensitive operational output outside Git. Refresh both the local and
private remote backup before applying requests after compatible code is deployed.

The administrator-only, same-origin `POST /api/gallery/maintenance/project-format`
accepts `{table, id, originalProjectText, projectText}` for `galleryEntries` or
`galleryEntryVersions`. It compares original text literally and independently
reproduces the conversion. A concurrent author edit returns 409; back up and
reconvert the new row instead of overwriting it. Already-converted rows are
idempotent. Each synchronous write replaces only `project_text` and
`schema_version`, preserving previews, timestamps, attribution, moderation,
likes and retained version identities. Private Cloud Projects are never accepted.

Read back all affected rows and compare against the expected backup, including
all other columns, before declaring migration complete. A worker rollback does
not reverse database writes: use the retained original rows and a separately
reviewed, equally bounded recovery operation if data restoration is needed.
Do not invoke the legacy whole-store restore on a Gallery-only backup.
