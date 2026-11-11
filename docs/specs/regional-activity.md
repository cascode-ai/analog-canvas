# Regional bookmarks and Selection Boards

Status: `accepted`

Primary owner: Gallery, Auth and regional replication.

Private Statistics bookmarks and link-shared [Selection Boards](selection-boards.md)
follow accounts through both entrances. Publication snapshots remain separate;
command authorization follows [regional actions](regional-actions.md).

## Rules

- Bookmarks read and write locally. Each `(account, entry)` has an explicit saved
  state, including a removal tombstone. A local change raises the last observed
  generation; higher generations win, and concurrent equal generations choose
  overseas. Repeated delivery neither toggles state nor creates another save.
- A bookmark command binds the signed-in account, intended state, observed
  version and command ID. A changed version or superseded receipt returns 409.
  The browser retains the same intent after an uncertain response, including
  reloads; switching accounts cannot apply that intent to another person.
  Older clients without an explicit state retain their legacy toggle behavior.
- Boards read locally. Existing Boards keep their original region as writer.
  New Board IDs are derived from the authenticated creator and creation command;
  their first character's code parity selects the writer (even China, odd overseas).
  Retrying creation through another entrance therefore reaches the same writer.
- Board changes carry an optional expected revision; the current page supplies
  it. All changes in a batch and its receipt commit together. The existing maker,
  administrator, signed-in editor and lock permissions apply at the writer.
  Referenced publications catch up before a foreign add/replace/create when needed.
- Replicas retain Board IDs, item IDs/order/type/notes, locks, revisions and full
  history. Original event sequence numbers remain visible at either entrance;
  replica storage uses separate local row identities to avoid collisions between
  historical Boards. Imported state produces no outbound Board changes.
- Each Gallery/Dataset store has a separate authenticated `-activity` stream.
  Its coalesced records have ordered cursors, epochs, hashes and durable receipts.
  Replay mismatches, changed epochs, ID collisions and Board regressions refuse
  the delivery without advancing the cursor. Private state never joins public
  feeds, publication exports or an unauthenticated synchronization endpoint.
- Activation indexes at most 100 missing Boards and 100 missing bookmarks per
  status/changes call. SQL triggers capture concurrent writes immediately;
  an accessed legacy identity is seeded before its mutation. Seed from live
  state, preserving IDs; backups are recovery evidence, not a replacement copy.
- Account retirement removes bookmarks and anonymizes Board authors/history.
  Receiving delayed state checks identity retirement before materialization;
  replay cannot restore the former account's access or display name.
- Keep activity records, tombstones, cursors and command receipts together in
  native Durable Object recovery or a full stopped-state ECS backup. The private
  activity export preserves Board `source_seq`, but a content export alone does
  not preserve replication or command state. Rollback must retain these tables.

## Contract

- `GET /api/gallery/bookmarks` and Dataset bookmark lists return the requesting
  account's `{ids, versions}`. `POST /api/gallery/<id>/bookmark` accepts
  `{accountId, saved, expectedVersion}` and `Idempotency-Key`; success returns
  `{saved, version}`. The version is `<generation>:<writer>` or null when absent.
- Board POSTs accept `Idempotency-Key` and `accountId`; change batches also accept
  `expectedRevision`. A same-command retry reconciles its receipt. A superseded
  revision returns 409 without replaying the earlier batch.
- `POST /api/resource-actions/board` is the authenticated peer command endpoint,
  limited to 256 KiB. The response carries a revision and synchronization head;
  the entrance catches up before returning the normal Board response.
- Activity envelopes are version 1, one coalesced identity per response, at most
  24 MiB. A Board snapshot permits 500 items and 100,000 history events; a mutation
  that exceeds its transferable limit rolls back with 413. Catch-up uses the
  existing 64-receipt/20-second bound. Pending propagation returns 503, retaining
  the operation identity. Peer outages do not block existing local Board reads
  or local bookmark writes; foreign Board mutations wait for their writer.

## Acceptance criteria

`worker/regional-activity.test.ts` exercises the real Worker/Auth/SQLite boundary:
both entrances, removals, concurrent writes, creation/change retries, restarts,
legacy identities, stale atomic batches, referenced publication catch-up, private
access and deleted identities. `worker/boards.test.ts` retains every Board action
and permission. The regional sync tick includes every Gallery/Dataset activity
stream alongside its existing publication and interaction streams.
