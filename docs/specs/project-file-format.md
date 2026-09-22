# Project File Format

Status: `accepted`

Portable file schema: `61`; normalized editor model schema: `58`.

Primary owner: `packages/project-protocol` (portable source and codec).
`packages/model` validates the normalized editor indexes used by rendering,
connectivity and transactions. The normalized indexes are decoded working data;
serialization always writes the one schema-61 authoring representation.

An `.icproj.json` file contains a complete Project. The public `parseProject`
boundary reads file schemas 24 through 61. Historical schemas pass through the
existing explicit upgrades; schemas 59 through 61 decode through the
owned-object codec. Schema 60 introduced derived network membership from
connection facts. Both return the same validated editor model. File/envelope
metadata must use `CURRENT_PROJECT_FILE_VERSION`, not the internal model
version.

## Instance-owned source

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
`galleryLikes`, `cloudProjects` and an optional opaque `after` cursor. Each page
returns at most one raw row, avoiding Cloudflare's SQL result-set memory limit.
A Gallery-only backup is `analog-canvas-gallery-backup-v2`: it includes all
statuses, all retained versions and like relationships, excludes private Cloud
Projects and must never be sent to the older full-store `schema-restore` route.
A paginated export records its capture interval rather than claiming a single
atomic database snapshot. Separate local and private remote copies are retained.

## Included component definitions

Schemas 58 through 61 save each referenced Symbol once in `componentDefinitions`.
Portable `Instance.type` (decoded as `Instance.symbolId`) and drafting
`floating-symbol.symbolId` reference these local classes. Each class contains
the complete Symbol geometry, pins,
variants, formula presentation, and its primitive electrical or black-box
subcircuit contract when applicable. Instance parameters and placement remain
on the Instance. An included definition takes precedence over the website's
built-in library. Editing its geometry updates every instance of that class;
copy the class to a new `symbol.id` (and matching electrical `symbolId`) and
change selected instances' `type` to customize only those instances.

Custom component internals are authored through Project Code or the
code-and-preview definition workspace (E / Edit Component Definition), not
through mouse-drawn shapes. The definition workspace publishes every save to
the public User Defined library and forks a new class for the selected
instance. Shared library revisions have versioned Symbol IDs; a Project keeps
its embedded definition even if the public entry is updated or removed.
Canvas transforms
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
import text -> parse JSON -> require Project file schema 24 through 61
-> migrate old files or decode 59/60/61 -> strict model validation -> install unbound
export -> validate -> encode file schema 61 -> readable canonical JSON -> download
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
already canonical Project file schema 61. Explicit `migrated` witnesses retain
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
