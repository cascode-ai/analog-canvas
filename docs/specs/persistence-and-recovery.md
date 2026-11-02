# Persistence and Recovery

Status: `accepted`

Primary owner: Worker Cloud Project storage, `packages/project-protocol`, and
the editor document lifecycle

Web: a private Cloud Project is the saved resource; `.icproj.json` is
import/export and backup. Desktop: an opened/saved `.icproj.json` file is.
Both use the one Project protocol; compatibility and migration belong to the
[file format](project-file-format.md). Persistence validates the complete
current schema before import or Cloud Save.

## Protocol-level rules

- Portable component interfaces validate with the Project: missing,
  duplicate or unknown pin mappings, duplicate formal port names and
  conflicting contracts reject the candidate (located diagnostics, live
  Project untouched).
- Polarity snapshot repair v1 fixes only the input marks of the sixteen
  converter-v8 differential-amplifier snapshots, by content signature
  (idempotent, reported as migration). Resemblance to a built-in never
  authorizes repair of other artwork; the catalog never overwrites
  project-owned definitions; Gallery sources are not bulk-edited.
- Op-amp supply-pin repair v1 gives the eight converter-v6 single-ended op-amp
  snapshots, by content signature, their `VDD`/`VSS` pins and leads and the
  variants that hide (default) or draw them, where the interface has both
  supply ports; a drawing looks and netlists as it did. A Circuit Component's
  artwork is never repaired.

## Browser recovery records

Complete canonical Project text in an app-specific IndexedDB store, keyed by
random `workingCopyId` plus `latest`/`previous` (never `projectId` alone).
Retention and size limits (20 closed sessions, one closed copy per Project
with unsaved copies yielding only to newer unsaved ones, 4 MB per record,
12 MB total) live in `apps/editor/src/document/browser-recovery-contract.ts`.

Envelope `analog-canvas-browser-recovery-v2` is separate from the Project
schema. Input is decoded structurally first; an unsupported schema classifies
as `unsupported-schema`, keeps its raw bytes downloadable and is never deleted
as corrupt; envelope identity must match the Project. Optional
`unsavedAtSnapshot` (older records: unknown, no startup offer) and
`cloudBinding` (`id` + acknowledged revision; older records restore unbound)
are lifecycle state, never Project data. A rejected write (oversize, quota,
unavailable) keeps every previous record readable and tells the user to
download. Only this app's store is pruned. Legacy `icm.recovery.v1`
localStorage migrates on first launch, removed only after the IndexedDB
commit; unmigratable data stays for raw download/discard.

## A page across deploys

A deploy keeps the week's earlier content-hashed assets online
([deployment](../deployment.md#assets-across-deploys)), so a page opened before
it keeps loading the dialogs and panels it has not used yet and keeps saving.
The editor checks the live entry script every 10 minutes while visible and on
focus (at most once a minute); once it differs it shows one dismissible notice
to reload when the work is saved, the reload restoring the current circuit.

## Browser-window workspace

- Open tabs, unsaved content, active tab, Cloud bindings and Cell views
  persist per window ([workspace storage](../../apps/editor/src/document/project-workspace.ts)):
  identity in sessionStorage, snapshots in IndexedDB, a synchronous journal
  for immediate refresh. Never changes a Cloud Project or enters Project JSON.
- The workspace key is the editor address minus consumed open requests
  (`resume`, `project`, `new`), with `/g/<id>` counting as `/editor`; plain
  `/editor` in the same window restores its tabs. `/editor?resume=1` (the
  account's Editor link) restores the complete workspace across routes.
  Explicit project, Gallery and New Circuit targets keep their semantics.
- A differing address (an example, a Gallery history branch) starts afresh;
  first every saved tab with unsaved work is stored as its own closed
  recovery session (File → Recover Unsaved Work). If that fails, the window's
  tabs stay, the new page saves none, and `?resume=1` brings them back.
- A Cloud Project deleted in the same tab (account page, Gallery shelf)
  restores as an unbound unsaved draft, like the editor Shelf's Delete.
- Refresh rebuilds without Undo or unfinished text edits, never marks
  content saved and keeps closed tabs closed; failures keep earlier snapshots.
- A fresh window with no workspace and no explicit open request (Gallery or
  Cloud link, example, `/editor?new=1`) non-modally offers ("Reopen tabs" /
  "Not now") the newest workspace a closed window left, if it holds unsaved
  work or a Cloud Project, Gallery entry or file. Open windows hold a Web
  Lock named after their identity and are never offered (no Web Locks, no
  offer). Reopened tabs join the window; an already open Cloud Project is not
  doubled unless unsaved, then it reopens unbound as `<name> (unsaved copy)`.
  The record is removed only once this window's saved workspace holds every
  reopened tab.

## Cloud Project and Save semantics

```text
POST /api/projects                 create and bind revision 1
PUT  /api/projects/:id             update the bound Project
PATCH /api/projects/:id            set favorite metadata only
If-Match: revision-N               reject stale writers
GET  /api/projects                 list distinct Projects
GET  /api/projects/:id             open one Project
DELETE /api/projects/:id           explicitly delete one Project
```

- One current revision per stable resource. Create/Save answer a summary;
  only Open returns `projectText`. Identical retries return the existing
  revision with no thumbnail or history; changed writes recheck revision at
  the atomic commit. Repeated Save updates the same id (no extra account
  slot). The first Save of an unbound Project creates one; there is no second
  command that silently duplicates. A revision mismatch or capacity limit
  blocks only that Save; the server never evicts another Project.
- Summary/open include nullable `galleryEntryId` (private publication
  metadata, preserved by full backups; older backups restore unlinked).
  Save never republishes or takes over a publication; `POST` may carry an
  authorized `galleryEntryId` for a just-published unbound draft; changing a
  draft's source is an explicit Gallery Publish/Update. Publish reloads source
  metadata when it opens.
- `favorite` (default false) is account metadata in summary, open and backup;
  it changes no bytes, revision or publication.
- Duplicate is an independent Project (new identity, no Gallery link). Rename
  is a revision-checked Save. Opening an already open Cloud id selects its
  tab without fetching. Delete keeps an open drawing as an unbound unsaved
  tab.

### Private save history

Each changed Save atomically snapshots the displaced revision; the newest
three earlier revisions are kept (pruning is final); identical retries add
nothing. Version history offers component comparison
([snapshot comparison](community-gallery.md#version-history)), Restore
(revision-checked Save keeping publication/favorite, never republishing) and
Branch (independent Project without that binding). Routes:
`GET /api/projects/:id/versions`, version `project`/`preview.svg` reads,
`POST .../versions/:versionId/restore`; private, not cached. Full-store
backups include snapshots; [Gallery-only backups](../gallery-backup.md) do
not. Storage: [Cloud Project storage](../../worker/gallery-store-cloud-projects.ts);
authorization: [HTTP handler](../../worker/gallery-cloud-projects.ts).

### Working-copy transitions

- The editor session owns only the Cloud binding (`id`, acknowledged
  revision), saved baseline and recovery id; no server session. An
  acknowledgement advances the binding; edits made in flight stay dirty; Undo
  back to the acknowledged content is clean.
- Dirty comes only from persistent edits; clean only from an acknowledged
  Cloud Save of the current content (selection, view, export and panels
  change nothing). File-menu/tab marks and the close question also treat a
  Gallery publication of exactly the current content as saved. While dirty,
  and only then, the browser-native `beforeunload` guard is registered; no
  synthetic history, custom warning or unload-time async reliance.
- Import/Export Project File never claim Save or clear dirty state; export
  never removes recovery records (only retention and explicit deletion do).
  Recovery writes capture identity before enqueueing; Cloud acknowledgement
  does not wait for them, and recovery failure never fails a Save.
- Opening/replacing stages and validates the whole candidate (bytes, JSON,
  schema, approved symbols, preparation) first; invalid input changes
  nothing. Before replacing dirty work the editor flushes a recovery write,
  then offers **Save to Cloud and continue**, **Continue without saving** or
  **Stay** (default Cancel). Cloud failure keeps everything in place; recovery
  failure is shown as elevated risk, never as permission to discard.
  **Continue without saving** deletes the outgoing recovery records; when it
  leaves the editor (Gallery, Analytics), the saved tabs drop the edits too
  (saved Projects revert, others close, the last yields to a blank circuit)
  before the page leaves. Other replacements keep the outgoing Project in
  recovery; the incoming Project gets its own working-copy id.
- Startup offers the tab's latest valid record non-modally (Restore,
  Download backup, Ignore) only when it says `unsavedAtSnapshot: true`, the
  foreground is clean and this is not a refresh-restore. Pending writes stay
  silent; failures surface while dirty.
- Only an explicit human **Replace Project** installs an Agent-staged
  candidate, ending the old Agent session.

## Desktop

The Windows preview (unsigned ZIP) serves the same editor on
`app://analog-canvas`, offline: online modules are excluded (checked
inventory) and native restrictions reject external requests; About opens only
fixed product URLs, sending no content, paths or credentials. App data is
`%APPDATA%\Analog Canvas`.

### Desktop file ownership

- The main process owns the library (`%USERPROFILE%\Analog Canvas\Projects`,
  one directory per Project with `project.icproj.json`; files are the source)
  and native grants. Renderers hold opaque binding IDs and acknowledged
  revisions; displayed paths authorize nothing. Changing the library root keeps
  previous roots and moves no files.
- Delete moves the Project directory to the recycle area; delete and permanent
  purge each ask for native confirmation.
- Save As is an independent identity, rebinding only on success; Export never
  rebinds or marks saved. Overwriting another saved Project archives it to the
  recoverable recycle area; overwriting the source or another open tab is
  refused; removing a recent never deletes a file.
- Writes go to a temp sibling and atomically replace, comparing target bytes
  with the acknowledged version before and again before replacement
  (optimistic, not a lock); failure keeps binding, edits and destination.
  First Save and copies record a durable creation identity first; retries
  reuse it only for matching content.
- Close saves or explicitly discards every dirty tab, keeping the window on
  cancel or failure, and awaits the workspace storage commit before closing.
  Changed saves keep three previous versions (retries do not rotate).
- Restore reacquires a grant only when the target's byte digest matches its
  receipt; otherwise a detached unsaved copy opens with a notice.
- The `.icproj` association is explicit from About; `.json` is never
  registered.

### Desktop User Components

Local records in app-data `components.json` (no login, sync or publication;
captures never rewritten) are serialized, validated and atomically replaced;
identical retries return the same revision; stale or invalid writes refuse;
removal is recoverable. Limits: 500 records / 16 MiB, 128 KiB per definition.
