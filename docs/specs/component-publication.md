# User Component publication

Status: `accepted`

Primary owner: User Components shared publication modules and Worker component library.
Project model/transactions own captured provenance; Agent and GUI are consumers.

Public `componentId` is stable across updates. A name is display content and
is not unique. A Project captures a fixed local class and optional
`ComponentDefinition.libraryOrigin`: public ID, captured revision, author ID,
content algorithm version and digest. Copies and portable saves preserve it;
local edits retain their original baseline. This hint never grants permission.
The server authenticates every write. Published packages omit local provenance.
Automatic native artwork has no captured class, so its origin is stored on the
native owner. Switching between Custom and Automatic preserves the baseline on
the active representation. When copying automatic artwork into an equivalent
owner with a different baseline, the copy captures the generated artwork and
its own provenance as a local class; the destination owner's baseline stays
unchanged. The native implementation remains shared. Legacy Agent snapshots omit this local metadata;
the `inspect` resource provides the publication association explicitly.

Publication destination is separate from origin. New and Create from remain
new through sign-in and draft recovery, including copies of one's own work.
Editing a verified own capture selects its original ID and captured revision.
Other authors' captures may be edited locally and published as new work.
Stale, deleted or unauthorized updates never silently become new publications.
Legacy captures without provenance require explicit association, checked against
the current public record and matching normalized package.

## Exact content and historical compatibility

Version 1 compares canonical JSON of the complete validated publication package.
Object keys are sorted; array order and source bytes are retained. Only owned
Symbol/electrical/subcircuit IDs, native owner/source/terminal identities and
their structural references are replaced, and the local source revision is
normalized. Authored names, geometry, variants, port order, mapping, parameters,
syntax/process, file paths/text and pinned dependency identities/digests remain.
No string search/replace or circuit equivalence is inferred. Provenance is omitted.

The Worker uses SHA-256 for lookup and compares canonical bytes before rejecting
a new ID with the same author's exact content. Different content with the same
name, or identical content by different authors, is allowed. Updating a historical
ID to match another does not merge records. Deleted records are excluded from new
duplicate candidates. Matches are selected by creation time, then ID.

The derived SQLite index permits multiple historical matches. Missing or outdated
rows are filled in resumable batches of 50 before writes may use it; invalid
history receives an index diagnostic. Concurrent creates check and write in one
Durable Object transaction. The index never changes public IDs, definitions,
authors, revisions, timestamps or statuses, and does not collapse library cards.

## Writes and recovery

After permission and expected-revision checks, an identical update returns
`unchanged` without changing revision or time. Duplicate new publications return
HTTP 409, `COMPONENT_ALREADY_PUBLISHED`, and `existing:{id,revision}`. GUI actions
are Use existing (explicit association) and Continue editing (new intent retained).

Successful and duplicate determinations retain exact account-scoped operation
receipts for seven days. A fixed key identifies fixed request bytes. GUI and
Agent share a private browser journal containing the original account, destination
and package; it survives Project undo. Retry sends the original snapshot even
after local editing. After receipt expiry, recovery can use the fixed target only
when permissions, matching bytes and the expected resulting revision agree.
Conflicts never cause a new ID to be generated. The private journal does not
travel to another browser with a portable Project; the draft retains destination,
and server protection still applies, but original-operation recovery belongs to
the browser that began it.

Cloud writes and Project association are separate transactions. Successful writes
are reported even if association is pending. Association changes metadata only,
requires matching current applied content, and uses ordinary Project history.
Undo cannot undo cloud publication or remove its operation receipt.

Agent `inspect` reads capture origin and a suggested destination. Explicit
publish/update/fork actions retain their meanings. `publicationVersion:1` opts
write callers into result outcome/recovery/association metadata and structured
duplicate references. Without it, legacy list/read/insert/write success shapes
remain unchanged; duplicate refusal still carries a useful code and message.
New MCP schemas/docs must be packaged and smoke tested before release. A website
merge does not release or install the separately versioned MCP package.

Portable schema 69 and runtime model 58 carry provenance. Schemas 24–68 remain
readable without invented origins. Old strict readers reject the new portable
envelope; rollback must retain a schema-69-capable reader and journal rather than
dropping origin fields or converting pending writes into new publications.
