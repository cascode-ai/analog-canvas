# Regional Identity and Data Synchronization

Status: `proposed`

Regional rollout contract; not enabled in Production.

Primary owner: Auth, Gallery, Component Library and regional replication.

China and overseas serve the same accounts and durable resources. Ordinary
Project reads and acknowledged saves use regional storage; asynchronous
replication carries changes. This extends [persistence](persistence-and-recovery.md),
not the Project file format. [Arena](analog-arena.md) retains its own owner and
forwarded-account contract; voting replication is a separate delivery.

## Identity and authorization

- [Regional login](regional-login.md) owns unified overseas authentication,
  browser-bound identity handoff, regional sessions, local authorization leases,
  trusted identity lookup and revocation semantics. Preserve existing `users.id`.
- Snapshot/import preserves resource owner IDs and resolves them through the
  authority independently of a user's first regional login. Unknown identities
  wait for reconciliation; resource stores never allocate replacement accounts.
- Replicate identity/profile and resource records as needed, excluding live
  sessions, provider secrets, login codes, grants, Agent claims and connector
  tokens. Profile replication grants no authorization.
- Account deletion must first deny new access at the authority, then send
  idempotent, versioned deletion work to each resource owner. Report regional
  cleanup separately from backup expiry. This cross-owner protocol is still
  proposed; a missing identity lookup is not a deletion instruction.
- Existing account quotas remain global. The resource owner reserves regional
  creation capacity and rejects exhausted or unavailable allocations. Saving an
  existing resource does not allocate another slot; Auth supplies identity and
  authority-originated attributes, not a second quota counter.

## Replicated and regional data

| Resource                                                   | Replication rule                                                                           |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Account IDs, verified identities, roles, blocks, deletions | Authority-originated security records                                                      |
| Private Cloud Projects and their retained history          | Regional writes; preserve ownership, lineage and conflict branches                         |
| Gallery publications, versions, moderation, likes          | Explicit resource events; private saves never publish automatically                        |
| User Components and publication status                     | Preserve component IDs, revisions, dependencies and permissions                            |
| Completed simulation metadata and retained files           | Immutable result references; transfer and verify file bytes before announcing availability |
| Active simulations and Agent/topology sessions             | Owned by their executing region; never replay a job by replicating its status              |
| Visitor statistics, caches, browser recovery               | Regional; not part of the account/Project merge                                            |
| Arena Battles, Votes and History                           | Outside this Canvas implementation; requires the Arena-side contract                       |

Gallery-only backups omit private Cloud Projects. Store backups include those
Projects but do not constitute an Auth, Component Library or simulation-file
backup. Inventory each owner before taking a migration snapshot; see
[backup scopes](../gallery-backup.md).

## Durable event protocol

Preserve pre-existing resource IDs. New resources require IDs unique across
both producers. An ID collision between unrelated resource origins or owners
is a reconciliation error, never an upsert that combines their contents.

Private Cloud Projects use the implemented [regional Project protocol](regional-projects.md).
The following proposal applies to the remaining resource owners; it is not a
second Project wire format.

```text
event:
  protocolVersion: 1
  eventId: UUID
  origin: cn | overseas
  originEpoch: immutable installation UUID
  streamId: owning-store identifier
  sequence: monotonically increasing integer within (originEpoch, streamId)
  resource: { kind, id, ownerUserId }
  operation: upsert | delete | security-change
  headId: globally unique revision identifier
  parents: prior observed headIds
  schemaVersion: resource schema version
  payloadHash: SHA-256 of canonical payload bytes
  payload: resource event or verified immutable-object references
  occurredAt: informational timestamp; never the ordering authority

ack:
  originEpoch, streamId, contiguousSequence
```

- The owning store commits resource state and its outbox event in the same
  durable transaction. A successful regional save acknowledges that transaction,
  not remote arrival. Across Durable Objects use recorded, retryable work;
  do not promise a transaction spanning all stores.
- Receive at least once. Persist `(originEpoch, eventId)` deduplication and
  apply state atomically. An imported event does not emit a new outbound event.
  Ack only contiguous durably applied sequences; a missing dependency or unknown
  schema blocks that cursor and raises an alert, rather than skipping a record.
- Each store has its own stream and cursor. There is no implied total order
  across stores or across regions. An ordinary restart preserves epochs and
  outbox. A restored backup starts with writes and sequence allocation fenced:
  reconcile peer cursors, recover all later accepted events and the sequence
  high-water mark before reusing its epoch. A peer must reject different event
  IDs or payload hashes at an already used stream position. If a complete
  recovery cannot be proved, reconcile resources and start an explicitly new
  epoch; never reuse lost positions or reset a peer's cursor silently.
- Transport uses TLS, separate narrowly scoped credentials per direction,
  source/destination validation, bounded payloads and rate limits. Browser
  credentials and a client-supplied owner ID confer no replication authority.
  Validate the resource schema, identity and permissions before applying it.
- Record replication lag, oldest unacknowledged event, retry count and blocked
  streams without payloads, login material or personal identifiers in logs.
  Backpressure is observable; a full outbox budget refuses new writes before
  accepting a change that cannot be durably recorded for replication.

## Conflicts, history and deletion

- Integer `revision` alone is not a global revision: both regions can produce
  revision 2 independently. Add a globally unique `headId` and use an opaque
  save token tied to it. Once a resource accepts two-region writes, every writer
  must submit that token. Legacy `revision-N` writes are allowed only while the
  resource remains single-writer; they cannot silently bypass the new check.
- A descendant can advance an uncontested head. Concurrent heads remain explicit
  conflict branches with their contents and provenance. Replicas converge on the
  same head set; receipt order and wall clocks never select a silent winner.
  Resolving a conflict creates a new head naming the resolved parents.
- Receiving a newer remote head never overwrites a browser's unsaved work. Its
  next save either uses the acknowledged head or returns a conflict. Normal
  retained history keeps its existing limit; unresolved branches are retained
  separately until resolution or explicit deletion.
- Likes are per-account state, not independently incremented global counters.
  Concurrent like/unlike resolves to unlike; moderation/rejection overrides a
  concurrent ordinary publication update. A public entry can only be restored
  through an explicit authorized action after observing that state.
- Deletion leaves a tombstone and dominates stale or concurrent updates. A
  deleted ID cannot be recreated by retrying an old event. Tombstones remain
  until every supported replica has acknowledged them; an abandoned replica
  must be retired and fully re-seeded before reconnecting.
- Immutable file references are usable only after size and digest verification.
  Until then show pending transfer; never serve a broken preview/result as a
  completed replicated object. Garbage collection waits for live references,
  tombstone acknowledgements and retention requirements.

## Introduction and rollback

1. Add disabled-by-default compatibility and transactional outbox support to
   the overseas candidate. Verify independently before any production release.
2. Enable capture before a snapshot; record per-store boundaries and schema
   versions. Use an owner-consistent snapshot or retry it; capture all identities
   and dependencies. Do not claim one global transaction across stores.
3. Import into a separate domestic production dataset, never the SSH test data.
   Replay after each boundary, hold unresolved dependencies, and compare hashes,
   owner mappings, counts and retained history while overseas remains writable.
4. Prove one-way catch-up before enabling domestic writes. Test duplicates,
   reordering, disconnection, simultaneous edits and deletion on synthetic data.
5. Enable two-way writes for a bounded account cohort, then expand after checks.
   Same-domain routing is a later switch and does not implement replication.
6. Rollback first freezes new writes in the affected region, preserves its
   outbox and unsynchronized branches, and reconciles accepted writes. DNS-only
   rollback cannot discard data already acknowledged to a user.

## Acceptance criteria

- One pre-existing account sees the same authorized resources in each region;
  simultaneous first login produces one identity or a retryable refusal.
- A successful local save survives process failure while transport is down;
  replay delivers it exactly once in observable state when transport returns.
- Concurrent saves retain both contents, and stale client tokens cannot overwrite
  either. Duplicate, reordered and looped events cannot multiply changes.
- Blocking/deletion expires regional access within the configured lease bound;
  replay cannot resurrect deleted data or privileges. Quotas do not double.
- Snapshot plus catch-up misses no acknowledged mutation. Restoring a backup
  older than the peer's acknowledged cursor cannot reuse sequence positions:
  the writer remains fenced until recovery or a reconciled new epoch is ready.
- Tests use the real Worker HTTP boundary and browser workflows already owned
  by this repository. Any new replication transport seam must be agreed before
  its test implementation. No test writes to overseas Production or uses its
  shared simulation slot.
