# Persistence and Recovery

Status: `accepted`

Primary owner: Worker Cloud Project storage, `packages/project-protocol`, and
the editor document lifecycle

Project content uses canonical schema-40 JSON. A private Cloud Project is the
formal saved resource; `.icproj.json` is portable import/export and backup.
The current-only model in `packages/model` validates the normalized shape;
`packages/project-protocol` owns parsing, compatibility diagnostics,
and canonical serialization. Persistence validates the complete current schema
before import or Cloud Save. The explicit schema 24→40 chain upgrades supported
historical files; serialization always writes schema 40. The 32→33 adapter
rejects ownerless Net equivalence instead of guessing replacement electrical
semantics, and the 33→34 adapter removes hidden electrical name authority while
preserving source spelling as provenance. The 34→35 adapter unifies parallel
Instance naming fields into one authored Reference. The 35→36 adapter repairs
styled Instance designators that schema 35 materialized as literal labels,
while retaining descriptive attached text. The 36→37 adapter only advances
the version stamp for the new optional Project `simulation` setup; no
existing Project has authored one, and none is inferred. The 37→38 adapter
adds no data: it only admits explicitly authored structured TRAN analyses. The
38→39 adapter adds no data either: it admits raw authored files and external
dependency declarations as the setup's mutually exclusive second input form.
Versions outside the implemented chain are rejected.

Recovery state is a non-authoritative browser safety copy. It may restore a
complete schema-40 Project or a supported historical record that validates
after the chained upgrade, associated with a recorded working-copy session.
Corrupt, incompatible, or partial recovery data is discarded or retained as raw
data without changing the live Project. User-saved Library examples are the
same class of origin-local, non-authoritative convenience data: canonical
serialized Project snapshots in their own IndexedDB store, re-validated
through the ordinary protocol boundary before they may replace a live
Project, and never a substitute for Cloud Save or an exported backup. Credentials, Agent bearer tokens,
selection, viewport, overlays, and pending external approvals are never
embedded in Project JSON or recovery records.

## Browser recovery records

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

## Cloud Project and Save semantics

The private Cloud Project API owns one current revision per stable resource:

```text
POST /api/projects                 create and bind revision 1
PUT  /api/projects/:id             update the bound Project
If-Match: revision-N               reject stale writers
GET  /api/projects                 list distinct Projects
GET  /api/projects/:id             open one Project
```

Repeated Save updates the same id and does not consume another account slot.
The first Save of an unbound New/imported/recovered Project creates a Cloud
Project. The editor exposes no second Save command that silently creates a
duplicate Project. The server retains no implicit save history and never
evicts another Project to make room. A revision mismatch or capacity limit
blocks only that explicit Save; editing and local recovery continue.

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
A successful replacement retains the outgoing Project in recent recovery and
seeds the incoming Project's own working-copy identity.

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
