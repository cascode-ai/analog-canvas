# Persistence and Compatibility

Status: `accepted`

Owners: `packages/project-protocol`, `apps/editor`, `apps/local-host`, `worker`

## Decision

Separate private Cloud Save, portable files and local recovery under
[persistence and recovery](../specs/persistence-and-recovery.md). Use one
current runtime shape and a contiguous reader upgrade chain under
[Project file format](../specs/project-file-format.md).
[Deployment](../deployment.md) owns the portable host boundary.

## Context

Saving, downloading a backup and recovering unsaved work have different
durability and identity guarantees. Rapid schema evolution must not make an
absent user's saved circuit unreadable.

## Rationale

Updating a stable Cloud Project avoids consuming a new resource on every save.
Acknowledged revisions protect against overwriting another writer; identical
retries need not create another revision. Check findings are independent evidence,
not a reason to withhold saving unfinished work.

Portable Project identity is not account storage identity. Recovery belongs to
the browser origin and cannot promise Cloud durability. A loopback PWA reuses the
same editor without requiring a second desktop runtime, but cannot pretend to
supply the hosted account service.

A fixed-width version window ties file lifetime to development velocity.
Keeping adapters at the file boundary preserves durability while runtime code
still sees one shape. This costs maintained adapters and focused tests, rather
than scattered legacy branches. Ambiguous electrical data must be refused with
a located explanation, not silently converted into guessed connectivity.

## Internal desktop preview decision (2026-09-26)

Add an isolated Electron preview alongside the Web/loopback products to test
bundled rendering and canonical file roundtrips. It uses an application origin,
no listening socket, and blocked external navigation/network. It does not
change the Web Save contract or introduce a second Project schema. Its first
file workflow is explicit export/import, not native file binding; see the
[preview contract](../specs/persistence-and-recovery.md#internal-desktop-preview).
The full D-A native file lifecycle remains separate from this preview.
