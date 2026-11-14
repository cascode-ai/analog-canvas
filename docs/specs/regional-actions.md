# Regional action parity

Status: `accepted`

Primary owner: Gallery, Component Library, Auth and regional replication.
This is the required behavior. The opt-in command route covers Community Gallery withdrawal, restoration,
deletion, curation and name/description edits, plus first publication, drawing updates/fixes/takeover, references, version restore, rejection, Dataset imports/comparisons, User Component save/status, Community/Dataset review submission and resolution, like changes and writer-routed maintenance. Per-entry opens use
the region components in [regional publications](regional-resources.md).

## Command delivery

- `RESOURCE_ACTION_PEER` is a fixed HTTPS service origin, independent of browser
  geographic routing. `RESOURCE_SYNC_PEER_TOKEN` permits ordered catch-up only;
  it grants no command authority. Without the peer setting, legacy routing stays.
- AUTH issues a 120-second opaque capability bound to one command digest and its
  destination. Redemption revalidates the original session or regional grant,
  including its current subject. A session change invalidates the capability.
  Dataset import alone also accepts an Owner token: AUTH revalidates the current
  token and Owner role before issuing and redeeming the bounded capability. The
  publication peer never receives the original Owner token.
- A peer command or writer lookup may wait through a domestic maintenance hold
  of up to 60 seconds. The transport allows 120 seconds, including execution;
  upstream proxies must not expire sooner. This does not replay a sent command
  or bypass the writer's command receipts and current authorization checks.
- The writer commits the mutation and its per-account command receipt together. Keep at most 10,000 receipts per account; exhaustion refuses new
  commands before mutation. Receipts are retained with the writer's backups;
  do not discard them during rollback or reset an identity to bypass the limit.
  Recovery uses the native Durable Object history or a full stopped-state ECS
  capture. A Gallery content export alone does not include command receipts.
  A deletion receipt survives the removed entry; its authenticated actor can
  reconcile the exact command after a lost reply. Other actors gain no access.
- The browser retains an uncertain command ID in session storage (memory when
  storage is unavailable). A successful action clears that entry's pending IDs.
  Older clients without IDs remain accepted but cannot reconcile a lost response
  as the same command.
- Name/description edits retain their existing last-write behavior for new commands.
  The Reference window retains a payload-bound command ID across retries/reloads;
  reconciliation never reapplies an edit over later metadata or drawing changes.
  Older metadata clients without IDs retain the legacy retry limitation above.
- Review resolution follows the review writer, including Dataset stores; only
  the Owner may resolve. Repeating a resolved review leaves its original
  resolution time and author intact, with a deterministic command ID for
  callers that do not supply one. A locally unknown review is located through
  the authenticated peer before resolution; unavailable ownership is not a
  missing review and never permits a local replacement.
- First Gallery publication and Review submission prepare a region-bearing
  intent before mutation. The browser retains its key and payload fingerprint
  across uncertain replies and reloads; the writer commits the successful
  result and receipt with the new record. Cross-entrance retry returns that
  result without creating another publication, review history item or quota
  charge. Explicit new intent permits a deliberate new publication or judgment.
  Reusing a key with different input is a conflict. Explicit older keys without
  a region have a deterministic writer; requests without a key retain legacy
  retry limitations. Submission keys are scoped to the account and endpoint.
  New browsers submit through the corresponding `/commit` endpoint, which
  requires a key. An older entry refuses this endpoint without mutation during
  a rolling release; the browser retains its intent for retry and never falls
  back to the legacy mutation endpoint. New servers still accept keyed legacy
  endpoints. Standalone deployments also retain receipts for `/commit`.
  Incomplete regional routing refuses submission; a standalone deployment
  cannot consume a region-bearing intent.
  Retain these receipts with the full store; they add no per-account lifetime
  submission quota. Gallery content exports alone cannot restore retry safety.
  Account retirement removes their personal result payloads; its retained
  retired-account fence prevents those commands from recreating data.
- Duplicate cleanup groups removals by publication writer. Each writer rechecks
  the survivor's current synchronized revision and electrical equality, and
  commits its group atomically with one receipt. A mixed-writer request reports
  every removal outcome; partial success is HTTP 207, never a global atomicity
  claim. The existing cleanup report removes only confirmed rows and retains
  the other rows and chosen survivor for retry.
  Each pending group retains its original IDs, revisions and command identity
  across reloads; a smaller displayed group or another group's request cannot
  replace that intent before reconciliation.
  A corrected rescan starts a new intent only after every failed item was
  definitively refused. Any uncertain or omitted item retains the original
  intent, even when another writer makes the aggregate response HTTP 409.
- Owner simulation-check requests dispatch explicit IDs to their writers;
  `all` selects each writer's own public testbenches. The queue and execution
  stay with that writer. A receipt records the accepted queue intent, so retrying
  after completion cannot run a second check. A new request identity permits an
  intentional rerun. Partial acceptance reports failed writers or IDs with HTTP
  207 and retains the browser's retry identity. Progress totals writer-owned
  results once; an unavailable writer makes the combined progress unavailable.
- Like changes follow the interaction writer, including Dataset stores and the
  Owner's heart increments/decrements. The browser first prepares an intent and
  persists its command ID, writer and expected interaction state before mutation.
  Retries carry that same intent even through another entrance. A changed state
  refuses the command; receipt reconciliation never toggles again after a lost
  response or a later writer change. Legacy requests without a prepared intent
  retain entrance-local retry protection only. Each account may retain at most
  10,000 entrance intents; exhaustion refuses preparation before mutation.
- Component writes and curation retain their required revision preconditions.
  Without an explicit command ID, derive one from the actor, resource, operation
  and validated revision-bound input. A repeated request reconciles its receipt;
  a later revision reports supersession without reapplying the old write.
- Drawing updates/fixes/AI takeover, version restores, reference replacement/removal,
  rejection and Dataset imports/comparisons rerun the existing route's validation
  at the publication writer. The writer records the successful store result in the
  same transaction as the publication and any colocated private Project binding.
  A retry compares publication state and Project links before acknowledging it;
  a changed link or superseded publication is a conflict, never a repeated edit.
  Missing Dataset rows do not claim a local writer. An authenticated peer lookup
  resolves existing ownership (including tombstones and legacy China records)
  before upsert. IDs absent in both regions are always created at the overseas
  writer, so simultaneous imports cannot establish two independent publications.
  An unreachable peer leaves new-ID ownership unconfirmed and refuses the write.
  These routes derive a deterministic payload-bound ID for older callers; an
  explicit new intent ID is needed to repeat the same payload after later changes.
- Dataset batches keep the existing per-item result shape. Each of at most ten
  items has its own writer and receipt; a failed or pending item is reported as
  such, while other items may succeed. A single publication command is bounded
  to 3 MiB. Unsupported Dataset routes retain their original restrictions.
- A foreign Community drawing update first catches up the private Project stream
  at its writer, then commits publication and binding together. Its entrance catches
  up both ordered streams before success and compares the resulting links. Each
  catch-up is bounded to 64 events and 20 seconds. Conflicted private saves are
  retained under the Project conflict protocol, not overwritten by publication.
- Optional rejection email uses a durable delivery ID and frozen complete provider payload
  (sender, recipients, subject, text and reply address).
  Confirmed delivery is never resent. An uncertain send may retry the same provider
  idempotency key for at most 23 hours (inside its 24-hour retention); after that it
  remains unconfirmed rather than risking duplicate mail. Sent payload bytes are
  discarded; expired pending payloads are cleared on subsequent delivery attempts.
- After foreign commit, the entrance catches up in cursor order, bounded to 64
  receipts and 20 seconds. An unconfirmed reply or pending propagation remains a
  retry with the same command ID, never a successful local read of stale state.
  If a later action superseded a retry's recorded status, reconcile it and report
  the conflict without repeating the earlier mutation.

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
  across entrances, under the [Board permissions](selection-boards.md) and
  [private activity protocol](regional-activity.md).
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
