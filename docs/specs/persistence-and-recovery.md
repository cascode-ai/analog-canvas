# Persistence and Recovery

Status: `accepted`

Primary owner: `packages/project-protocol` and the editor document lifecycle

Portable Projects use canonical schema-27 `.icproj.json`. The current-only
model in `packages/model` validates the normalized shape;
`packages/project-protocol` owns parsing, rolling compatibility diagnostics,
and canonical serialization. Persistence validates
the complete current schema before open or save and writes atomically where the
platform supports it. Schema 25 upgrades to 26 at ingestion; serialization
always writes schema 27. Older schemas are rejected outside the rolling
current-and-previous compatibility window.

Recovery state is a non-authoritative browser safety copy. It may restore a
complete schema-27 Project or a schema-25 record that validates after the
bounded upgrade, associated with a recorded working-copy session.
Corrupt, incompatible, or partial recovery data is discarded or retained as raw
data without changing the live Project. User-saved Library examples are the
same class of origin-local, non-authoritative convenience data: canonical
serialized Project snapshots in their own IndexedDB store, re-validated
through the ordinary protocol boundary before they may replace a live
Project, and never a substitute for the downloaded `.icproj.json` file. Credentials, Agent bearer tokens,
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
  consume a new generation;
- one record's Project text is at most 4 MB (UTF-8, recomputed on read);
- all owned records total at most 12 MB.

Records use a versioned envelope (`analog-canvas-browser-recovery-v2`) that is
separate from the Project schema and never enters `.icproj.json`. Stored input
is decoded structurally before its Project text is parsed, and a record whose
Project text carries an unsupported schema version classifies as
`unsupported-schema`, keeps its raw bytes downloadable, and is never deleted as
corrupt. Envelope identity fields must agree with the parsed Project.

A rejected write (oversized, quota exceeded, storage unavailable, or failed)
must leave every previous record readable. Storage or quota failure is visible
to the user and never destructive: the previous record is kept and the user is
told to download the Project. Only this application's own object store is ever
pruned; the editor never clears all IndexedDB databases or origin storage.

The legacy `icm.recovery.v1` localStorage slot migrates into IndexedDB on first
upgraded launch; the old key is removed only after the IndexedDB transaction
commits. Unmigratable legacy data stays in localStorage for raw
download/discard.

## Save semantics

Save, Save As, Download, Open, Import, Restore, and Replace are distinct
lifecycle outcomes; a handler must not report one as another. File System
Access writes are progressive enhancement initiated by a user gesture; only a
confirmed `createWritable`/`write`/`close` sequence is reported as a confirmed
save. Everywhere else the editor falls back to a canonical Blob download
reported as `Download requested`, not `Saved`, because the browser does not
confirm durable download completion. Saving or downloading never clears
recovery records; bounded retention and explicit user deletion are the only
removal paths. File handles stay transient runtime capabilities and are never
serialized into Project JSON or recovery records.

Opening or replacing a Project stages and validates the complete candidate —
read bytes, JSON/schema validation, approved-symbol validation, Project
preparation — before the live Project changes. Invalid input leaves the
Project, selection, history, recovery, and file state untouched. Before
replacing dirty work the editor first confirms a recovery write; if recovery
fails it offers download, replace-anyway, and cancel, defaulting to cancel.
A successful replacement retains the outgoing Project in recent recovery and
seeds the incoming Project's own working-copy identity.

Agent File Resource staging stores a bounded candidate separately from the
browser Project. Inspecting or requesting approval does not mutate the live
Project. Only an explicit human **Replace Project** action may install a valid
candidate, and replacement terminates the old Agent session.

Required validation covers canonical save/load/save byte stability, exact
schema-version rejection, atomic-write failure, corrupt recovery,
unsupported-schema retention, envelope/Project identity mismatch, retention
ordering, quota and storage failure mapping, staged-candidate isolation, and
human-approved replacement.
