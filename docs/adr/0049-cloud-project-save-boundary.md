# ADR 0049: Stable Cloud Project Save Boundary

Status: accepted

Date: 2026-08-28

## Context

The editor previously called a local File System Access write or Blob download
“Save Project”, while a separate signed-in action appended rolling cloud
snapshots. The two authorities made dirty state ambiguous, and repeated saves
of one circuit consumed the bounded cloud shelf.

## Decision

- `Save` means one explicit private Cloud Project create/update operation.
- A stable server `cloudProjectId` is separate from portable `Project.id`.
- A bound update carries an acknowledged revision; stale different content is
  rejected, while an identical retry returns the existing revision.
- The account limit counts distinct Cloud Projects. Save never evicts another
  Project and the server retains no implicit version history.
- The editor Session is runtime state: Cloud binding, saved baseline, and one
  recovery working-copy id. It is not a server table or Project JSON field.
- IndexedDB recovery remains the local-first crash-safety layer. Its envelope
  may carry the transient Cloud binding so reload continues the same resource.
- `.icproj.json` is explicit Import/Export/Backup interchange. It never clears
  Cloud dirty state and is never labeled Save.
- Editing, Undo, rendering, and recovery do not depend on network availability.

## Necessary blocking boundaries

Only destructive replacement of dirty work, browser leave while dirty, Cloud
revision conflict, capacity, and explicit Cloud deletion require a decision.
Offline or failed Save remains a visible state but never disables editing.

## Consequences

The rolling workspace-snapshot route, client, UI, and File System Access Save
path are retired. Cloud storage keeps only current canonical Project text;
cross-device product guarantees, automatic cloud save, server-side Sessions,
version history, and automatic conflict merge remain out of scope.
