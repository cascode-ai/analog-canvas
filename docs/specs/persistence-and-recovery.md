# Persistence and Recovery

Status: `accepted`

Primary owner: Worker Cloud Project storage, `packages/project-protocol`, and
the editor document lifecycle

Project content uses canonical schema-60 JSON. A private Cloud Project is the
formal saved resource; `.icproj.json` is portable import/export and backup.
The current-only model in `packages/model` validates the normalized shape;
`packages/project-protocol` owns parsing, compatibility diagnostics,
and canonical serialization. Persistence validates the complete current schema
before import or Cloud Save. Compatibility and migration failure rules belong to the
[file-format contract](project-file-format.md). The protocol reader upgrades
supported historical content before current-schema validation; all writers emit
the current schema. Persistence does not maintain a separate migration policy.

Recovery state is a non-authoritative browser safety copy. It may restore a
complete schema-60 Project or a supported historical record that validates
after the chained upgrade, associated with a recorded working-copy session.
Corrupt, incompatible, or partial recovery data is discarded or retained as raw
data without changing the live Project. User-saved Library examples and their
browser store are retired. Credentials, Agent bearer tokens,
selection, viewport, overlays, and pending external approvals are never
embedded in Project JSON or recovery records.

## Browser recovery records

These bounded crash-recovery copies are distinct from the window workspace
below. They do not limit the number of open project tabs.

Recovery copies are complete canonical Project texts stored in IndexedDB under
an application-specific database, keyed by a random `workingCopyId` plus a
`latest`/`previous` generation, never by `projectId` alone. The executable
limits live in `apps/editor/src/document/browser-recovery-contract.ts`:

- at most 2 retained working-copy sessions, the active one always kept and the
  oldest inactive session pruned first;
- at most `latest` and `previous` per session; identical Project text does not
  consume a new generation. Save-state and formal-file metadata may update the
  latest envelope in place without rotating its Project text into `previous`;
- one record's Project text is at most 4 MB (UTF-8, recomputed on read);
- all owned records total at most 12 MB.

Records use a versioned envelope (`analog-canvas-browser-recovery-v2`) that is
separate from the Project schema and never enters `.icproj.json`. Stored input
is decoded structurally before its Project text is parsed, and a record whose
Project text carries an unsupported schema version classifies as
`unsupported-schema`, keeps its raw bytes downloadable, and is never deleted as
corrupt. Envelope identity fields must agree with the parsed Project. The
optional `unsavedAtSnapshot` envelope field records whether the snapshot was
ahead of the formal save baseline. Records written before this additive field
remain valid but have unknown save state and therefore do not trigger an
automatic startup offer. This metadata is browser lifecycle state, never part
of Project JSON. The optional `cloudBinding` (`id` plus acknowledged revision)
lets a reload continue updating the same Cloud Project; records that predate it
restore unbound rather than guessing an identity.

A rejected write (oversized, quota exceeded, storage unavailable, or failed)
must leave every previous record readable. Storage or quota failure is visible
to the user and never destructive: the previous record is kept and the user is
told to download the Project. Only this application's own object store is ever
pruned; the editor never clears all IndexedDB databases or origin storage.

The legacy `icm.recovery.v1` localStorage slot migrates into IndexedDB on first
upgraded launch; the old key is removed only after the IndexedDB transaction
commits. Unmigratable legacy data stays in localStorage for raw
download/discard.

## Browser-window workspace

The editor persists its open project tabs, unsaved Project content, active tab,
Cloud bindings and Cell views separately from bounded crash recovery. Refresh
restores that window's workspace for the same route. The window identity is
kept in sessionStorage, with snapshots in IndexedDB and a synchronous journal
for immediate refresh. This state never changes a Cloud Project or enters
portable Project JSON. See
[workspace storage](../../apps/editor/src/document/project-workspace.ts).

Inactive tabs retain live controllers and Undo histories during a session;
refresh reconstructs controllers without Undo stacks or unfinished text-field
edits. Workspace restoration does not make unsaved content formally saved.
A closed project tab stays closed after refresh. Read/write failures leave
earlier snapshots intact and report the need to export; clearing browser data
can remove this origin-local state. Cloud Save and portable backups remain
separate durability choices.

## Cloud Project and Save semantics

The private Cloud Project API owns one current revision per stable resource:

```text
POST /api/projects                 create and bind revision 1
PUT  /api/projects/:id             update the bound Project
PATCH /api/projects/:id            set favorite metadata only
If-Match: revision-N               reject stale writers
GET  /api/projects                 list distinct Projects
GET  /api/projects/:id             open one Project
DELETE /api/projects/:id           explicitly delete one Project
```

Cloud summary/open responses also return nullable `galleryEntryId`. This is
private publication metadata, separate from the portable Project document and
from its content revision. The additive column leaves pre-existing rows unlinked
and does not rewrite their drawings. Full schema backup/restore preserves the
link; older backups without it restore as unlinked. The browser reloads current
source metadata before presenting Publish, so recovery pointers are not authority.

Save never republishes a drawing or takes over an existing publication's source.
`POST /api/projects` may include an authorized `galleryEntryId` for a just-published
unbound draft; an existing source remains in place. Changing a saved draft's
publication source is an explicit Gallery Publish/Update transaction, not a
side effect of `PUT /api/projects/:id`.

Repeated Save updates the same id and does not consume another account slot.
The first Save of an unbound New/imported/recovered Project creates a Cloud
Project. The editor exposes no second Save command that silently creates a
duplicate Project. Changed saves retain bounded history as described below;
the server never evicts another Project to make room. A revision mismatch or
capacity limit blocks only that explicit Save; editing and local recovery continue.

Shelf cards expose Duplicate, Rename, Export, Favorite and Version history
through the visible actions button, plus Open in new tab. Right-click and
long-press retain normal browser behavior. Duplicate creates an independent
private Project with all serialized circuit/source data
and a new Project identity; it never inherits a Gallery link. Rename loads the
current document and uses revision-checked Save, preserving its other content
and publication association. Export downloads the complete stored Project file.

Favorite is account-scoped metadata (`favorite`, default false), included in
summary/open and full backup/restore. Toggling it changes neither Project bytes
nor the drawing revision or publication; starred cards sort first. Older backups
without the field restore false. Card actions report capacity, permission and
revision failures without deleting existing Projects or overwriting newer edits.

### Private save history

Each changed Save atomically snapshots the displaced revision and advances the
current Cloud Project. The newest three earlier revisions are retained; the
current revision is separate. Identical retries create neither another revision
nor a history entry. Pruning does not recover previously discarded history.
The account boundary and optimistic revision guard remain the same as Save.

Shelf **Version history** lists saved revisions and offers component comparison,
Restore and Branch. Restore goes through revision-checked Save, preserving the
displaced current version within the same retention bound. It retains the
Project's publication/favorite binding but never republishes to Gallery.
Branch opens an independent Project without that binding; saving it creates a
new private draft. Component comparison uses the same
[snapshot comparison](community-gallery.md#version-history) as Gallery history.
This is bounded save history, not named milestones or a merge graph.

The owned routes are `GET /api/projects/:id/versions`, version-specific
`project`/`preview.svg` reads, and `POST .../versions/:versionId/restore`.
Responses are private and not cached. Full-store backup/restore includes these
snapshots; [Gallery-only backups](../gallery-backup.md) intentionally do not.
The executable storage/retention boundary is
[Cloud Project storage](../../worker/gallery-do.ts); authorization and restore
reuse live in [the HTTP handler](../../worker/gallery.ts).

### Working-copy transitions

The editor session owns only the transient Cloud binding (`id` and acknowledged
revision), the saved content baseline, and its recovery working-copy id. No
server Session record is created. A successful Cloud acknowledgement advances
the binding and saved baseline. If edits occurred while the request was in
flight, the submitted snapshot is saved but the newer live content remains
dirty. Undo back to the acknowledged content becomes clean.

**Import Project File** and **Export Project File** are interchange operations.
They never claim to be Save and never clear Cloud dirty state. A contextual
backup download is offered only when recovery needs attention. Export/download
does not remove recovery records; bounded retention and explicit user deletion
remain their only removal paths.

The editor persistence lifecycle is the single source of unsaved truth. A
successful persistent edit marks it dirty; only an acknowledged Cloud Save of
the current content marks it clean. Selection, view, export, download, and
panel changes do not. While dirty, and only while dirty, the editor registers
the browser-native `beforeunload` guard for Back, Refresh, and tab/window close.
The application does not synthesize history entries, customize the
browser-owned warning, or depend on unload-time asynchronous storage as its
only protection.

Opening or replacing a Project stages and validates the complete candidate —
read bytes, JSON/schema validation, approved-symbol validation, Project
preparation — before the live Project changes. Invalid input leaves the
Project, selection, history, recovery, and file state untouched. Before
replacing dirty work the editor first attempts and flushes a recovery write,
then offers **Save to Cloud and continue**, **Continue without saving**, or
**Stay**,
defaulting to Cancel. Cloud Save failure leaves the foreground
Project and dialog in place. Recovery failure is shown in the same dialog as
elevated risk but never grants permission to discard.
A successful replacement seeds the incoming Project's own working-copy
identity. **Continue without saving** is an explicit discard: it deletes the
outgoing working copy's recovery records before the replacement proceeds.
Every other successful replacement retains the outgoing Project in recent
recovery.

On startup, the current tab's latest valid recovery record is offered
non-modally only when it explicitly says `unsavedAtSnapshot: true`, the
foreground Project is still clean, and the load is not the editor's explicit
refresh-restore path. The offer provides Restore, Download backup, and Ignore.
Normal pending/stored recovery writes stay silent; only failures are promoted
while the foreground work is dirty.

Agent File Resource staging stores a bounded candidate separately from the
browser Project. Inspecting or requesting approval does not mutate the live
Project. Only an explicit human **Replace Project** action may install a valid
candidate, and replacement terminates the old Agent session.

Required validation covers stable Cloud identity, optimistic revision
conflict, capacity without eviction, canonical import/export stability, exact
schema-version rejection, corrupt recovery,
unsupported-schema retention, envelope/Project identity mismatch, retention
ordering, quota and storage failure mapping, staged-candidate isolation, and
human-approved replacement.
