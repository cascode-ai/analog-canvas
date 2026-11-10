# Regional action parity

Status: `accepted`

Primary owner: Gallery, Component Library, Auth and regional replication.
This is the required behavior; cross-region commands and the additional
replication scopes below remain to be delivered.

## Rules

- The same account has the same resource permissions through China and overseas.
  Geography never grants permission or removes an existing permission. Ownership,
  moderator scope, account blocks, revision checks and blind review still apply.
- [Publication](regional-resources.md) and interaction writers remain internal
  consistency boundaries. An entrance routes an authorized change to its writer;
  it never asks the user to change region or permits direct replica writes.
  The rule applies in both directions, including publications created in China.
- Cover withdrawal, restore, edit, metadata and curation changes, rejection,
  deletion, Dataset corrections, User Component save/status changes, unlike and
  review resolution. Multi-resource operations preserve their existing atomicity
  or explicitly report each outcome; no success response conceals a skipped copy.
- Delegation binds the authenticated actor and subject, destination, operation,
  resource, preconditions and request content. The destination rechecks current
  permissions. A body-supplied account ID, replica snapshot, backup credential or
  replication token cannot authorize a user command. Keep existing session,
  account-switch and CSRF protections; forward no provider credentials.
- A committed command has a durable receipt. An ambiguous response is reconciled
  with the same operation identity; it is not replayed as a new edit or toggle.
  Changed reuse of an identity is refused. Audit and version records occur once.
- A confirmed change is visible to its caller through that entrance. Subsequent
  reads must not silently restore the older replica state. Distinguish committed
  but pending propagation from a refused operation. Preserve ordered sync cursors,
  tombstones and receipts; an action response cannot skip intervening events.
- A writer outage may delay a cross-region action. Return a bounded, truthful
  result and preserve unsaved work and operation identity. Ordinary local reads
  and independent private saves retain their existing availability. Equal
  permissions do not promise cross-border writes while the writer is unreachable.
- Private Cloud Project saves, history, favorites, deletion and conflict resolution
  retain the [Project protocol](regional-projects.md). A publication edit must
  preserve its private Project binding and record both effects durably; separate
  publication and Project stores are not an implied distributed transaction.
- Private Statistics bookmarks follow the account across regions, including
  removal. They remain private, distinct from public likes and Project favorites.
  Selection Boards retain their IDs, revisions, entries, locks and audit history
  across entrances, under the [Board permissions](selection-boards.md).
- Per-entry open counts converge without overwriting a region's accepted counts
  or adding the same delivery twice. They are separate from site-wide
  [visitor statistics](regional-analytics.md). Existing per-region publication
  admission is not evidence that a global quota is enforced.
- Before expanding synchronization, back up and reconcile both regions' existing
  records. Preserve IDs, ownership, private data boundaries and deletions. Never
  seed by overwriting one live region with the other or discard unclassified rows.
- Active Agent connections and simulation jobs remain with their executing
  service; replication must not replay them. Arena has its separate
  [contract](analog-arena.md); Canvas parity does not certify Arena voting/History.

## Acceptance criteria

- Publish in one region; from the other, its owner edits, withdraws, restores and
  deletes it. Repeat with the origins reversed. A different account remains
  forbidden, and an owner cannot undo a moderator rejection without permission.
- Edit/delete/restore a foreign User Component with revision checking; unlike
  and resolve a foreign interaction with the existing actor's permissions.
- Lose a response after commit, retry, and restart: one effect and one receipt
  survive. Concurrent stale edits conflict. Offline synchronization later
  converges without resurrecting withdrawn/deleted data or reversing a bookmark.
- Read the result through the initiating entrance before and after replica
  catch-up. A stale replica cannot contradict acknowledged status or permissions.
- Verify private save/history/restore, Project favorites, Gallery binding changes,
  Statistics bookmarks and Board edits separately. Test with synthetic owned data;
  use no user's existing circuit for destructive acceptance.
- Monitor command refusals, reconciliation failures and propagation lag alongside
  existing sync health. A caught-up stream does not prove action parity or coverage
  of a table absent from the protocol. Logs contain no credentials or private bodies.
