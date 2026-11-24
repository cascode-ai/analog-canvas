# Regional Cloud Projects

Status: `accepted`

Primary owner: private Project storage and replication. Opt-in implementation;
disabled in Production. [Regional login](regional-login.md) supplies sessions
and identity lookup. Gallery, User Components, Arena and simulation are separate
deliveries under the [regional roadmap](china-regional-identity-sync.md).

## Project file releases

The Project protocol records the newest file it can read and the version it
writes in `packages/project-protocol/src/file-format.json`. Land the decoder,
migration and old-format writer first. Keep new-format authoring disabled.
Once that release is verified in both regions, advance the writer and enable
the feature. Other merges continue to follow the usual release workflow.

The deployment checks the exact overseas release served by the fixed origin.
A writer advance additionally requires that release's matching CI receipt and
a smoke-verified Hangzhou reader. If a region is still catching up, rerun the
release once its reader is installed. A missed reader-only release must be
shipped before the writer. Roll back application changes using a release that
retains the installed format capabilities. Automatic recovery of a failed
writer activation can use the preceding reader because it already reads every
format the candidate could have written.

During the transition each region can save Projects in its active format.
Replication preserves the other region's current and historical bytes. An
edit requiring fields the local writer cannot retain is refused before a
revision or journal event is created. Keep the draft and retry after that
region's writer activates.

## Rules

- A participating store preserves existing Project and owner IDs. Browser
  access uses the local AUTH session; peer import verifies the owner through
  the authority's identities endpoint. Missing owners block import, never
  delete data or allocate replacement accounts.
- When the overseas store owns the configured identity endpoint, it sends that
  same authenticated request through its `AUTH` binding. Ownership requires the
  exact identities URL under `AUTH_REGIONAL_AUTHORITY.origin`; other endpoints
  and domestic identity checks keep their configured HTTPS transport. The
  authority still checks the credential, origin and original account.
- A restricted trial sets the same `PROJECT_REGION_USERS` JSON account list
  on the HTTP entry and both stores (at most 50 IDs). With
  `PROJECT_SYNC_EXPANSION=off` (default), capture, quota and imports follow that list.
  Outside the list, overseas uses legacy saves, publication and account deletion,
  and China refuses Project access. Omitting the list retains the all-account
  opt-in mode.
- Set `PROJECT_SYNC_EXPANSION=copy` on China before the source. Keep browser
  and quota admission at the trial scope and coordinate account deletion for
  every owner. Seed every overseas Project and replay its subsequent legacy
  changes through the same stream. Pause domestic writes during the baseline
  handoff, including writes through Gallery bindings. After the first outside
  event is captured, stop or retry seeding on the same compatible release with
  both peers in `copy`. The trial browser scope stays restricted and deletion
  must continue to cover copied owners. Older trial-only releases cannot serve
  a stream that already includes outside accounts.
- Advance to `all` on the source first, then China, after the seed queue empties
  and China applies the source high-water mark. Verify the remaining queue and
  both receipts before enabling domestic writes. Retain the verified `all`
  versions and configuration for subsequent release rollback. Reconcile both
  stores and preserve acknowledged writes before reducing scope.
- A historical-copy trial sets the same `PROJECT_PROTECTED_IDS` JSON list on
  both stores before capture (at most 1000 IDs). China can read and receive
  those Projects and their history, but refuses local save, restore, deletion,
  favorite, preview-cache writes and publication binding changes with 403
  `protected-project`. Overseas refuses incoming events for those IDs while
  preserving its owner's normal local operations. Unlisted new test Projects
  retain bidirectional writes. An omitted list preserves unrestricted regional
  behavior; malformed configuration fails closed. Keep the list fixed during
  acceptance; a rejected event blocks its ordered stream, never skips a receipt.
- Save commits the current Project, retained three earlier saves and outbound
  event in one local transaction. HTTP success acknowledges local durability,
  not arrival in the other region. Failed journal capacity rolls back the save.
  Keep recognized older history documents byte-for-byte even if the current
  editor cannot open them. The current Project and history restore still
  require successful parsing.
- Regional PUT and history restore require the returned opaque `saveToken` in
  `If-Match`. For previously opened overseas tabs, full admission also accepts
  a matching integer revision while the Project has a single, entirely local
  lineage. After any remote change it requires the opaque token. Preview
  responses use no-store because integer revisions can coincide.
- Concurrent edits retain their heads and contents. My shelf exposes downloads
  and explicit selection; resolution must name exactly the current head set.
  A stale choice is refused. Deleted IDs remain tombstoned; late saves cannot
  recreate them. Unresolved branches are separate from ordinary save history.
- New-project quota is coordinated by the overseas Project store, including
  durable grants to China; the total is twenty per owner. China applies the
  grant's contiguous event before using it. Only a sequence gap starts an
  extra ordered pull, limited to one event and a two-second network budget;
  the normal Project sync tick continues longer catch-up.
- Retry an ambiguous creation with the same `Idempotency-Key` and content. The
  creation fingerprint includes the requested Gallery binding and travels with
  the Project; a changed request is refused in either region. A definite source
  rejection rolls back its local quota reservation with the failed creation.
  The
  editor retains both in the current page, recovers the created binding, then
  conditionally saves newer edits before acknowledging them. A definite initial
  refusal permits corrected content under the same key. A lost quota reply
  never releases an existing reservation.
- With the domestic durable writer enabled, an authorized keyed create stores
  one pending operation per account and key. HTTP 503 `project-create-pending`
  with `Retry-After` acknowledges durable acceptance. The original key and
  content can retrieve the resulting Project. Multiple attempts share one
  business result; their receipts retain which attempt or timer completed it.
  The sync tick resumes work after a browser closes. A transfer fences the
  old executor before another generation can change the Project or its receipt.
- Recovery input stays in the private local store for at most seven days of
  timer operation, then requires scoped reconciliation. Completion and account
  retirement erase the input. The store accepts at most twenty pending creates
  per account, 512 overall, and 64 MiB of private input. The commit rechecks
  Gallery ownership and any required moderator privilege. Attempt audit
  records retain only opaque identifiers and outcomes for thirty days.
- A reader advertises supported operation versions and the actual pending
  inventory over loopback before a separate release enables writing. A
  legacy claim without a linked durable operation requires independent proof.
  Unknown formats and integrity conflicts do not authorize handoff.
- Each producer has one ordered stream and installation epoch. Import checks
  payload hash, schema, owner, ancestry and contiguous sequence, then commits
  content and receipt together. Duplicate delivery is harmless; imports do not
  echo. Unknown versions, gaps or collisions block the stream.
- Journal payloads and conflict nodes have a configured byte ceiling. Events
  use small SQLite chunks so retained history does not exceed a single row's
  runtime limit; derived thumbnails are regenerated by the receiving region.
  The stored-byte budget includes legacy text and gzip chunks. The decoded
  event limit and peer protocol are independent of that encoding. Set
  `PROJECT_SYNC_COMPRESS_JOURNAL=true` only after a compatible release is
  available for rollback. Disabling compressed writes still reads existing
  chunks. Never roll a compressed store back to a reader without gzip support.
  With a verified off-host recovery checkpoint, an administrator can reclaim
  inactive payloads up to the checkpoint and both peers' acknowledged
  positions. Active heads, conflicts, tombstones, quota, ancestry and original
  positions and digests survive. A peer behind the compacted outbound floor
  must recover from a newer checkpoint. Keep a rollback that can read that
  floor once compaction starts. Monitor pending count, oldest pending time,
  bytes, delivery status and consecutive failures.
- Restart fences writes until peer reconciliation. A peer receipt beyond the
  restored local high-water mark requires recovery from a newer complete state;
  lowering the peer cursor cannot erase that evidence. The implementation never
  resets epochs or reconstructs missing acknowledged writes automatically.
- Source capture emits one existing Project plus its retained history per seed
  call. It queues changed legacy Project IDs transactionally after first
  capture, then seeds their latest state or deletion. Regional live writes
  capture their predecessor first in the same transaction.
  Preserve the existing source singleton and compare both replicas before
  opening domestic writes. A Gallery-only export is not this migration format.
  With `PROJECT_REGION=overseas` and no explicit `PROJECTS` binding, the HTTP
  entry uses the existing `GALLERY` singleton named `gallery` for Projects and
  synchronization. This needs no new namespace or scheduled push to China.
- The colocated Gallery store commits publication-binding changes and their
  Project events in the same transaction, including changing the source draft
  and clearing a former owner's binding during takeover. Journal exhaustion or
  an unresolved affected Project conflict refuses the publication; it cannot
  acknowledge an unjournaled binding. The Project stream carries private binding
  metadata, not public Gallery entries; Gallery replication remains separate.
- Enable [coordinated account deletion](regional-login.md#account-deletion)
  before broadening Project admission. Each store removes the retired owner's
  Projects, retained versions, conflict payloads and quota grants. It retains
  tombstones and the original event IDs, positions and digests. An erased
  position carries the retired ID and an empty payload. A peer verifies the
  retirement with the authority before recording that receipt. Late payloads
  for retired IDs are acknowledged without materializing them. Unknown owners
  still block their position.
- Use [regional recovery](../deployment.md#point-in-time-recovery) for restore.
  Legacy destructive restore and schema conversion are disabled in regional mode.
- A private region may initiate both directions with `PROJECT_SYNC_PULL=true`.
  Each tick pulls at most one event, then delivers at most one local event.
  Pull reconciles peer status and verifies its receipt before acknowledging
  delivery. A lost pull response is retried from durable receipts; it never
  permits lowering a recovery fence or exposing an inbound domestic listener.

## Contract

The [event decoder](../../worker/project-sync-protocol.ts) owns the wire schema;
[journal](../../worker/project-sync-journal.ts) owns durable cursor semantics.
The [HTTP transport](../../worker/project-sync.ts) owns endpoint authorization.

| Endpoint                               | Credential                    | Behavior                                                                                          |
| -------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------- |
| `GET /api/project-sync/status`         | Direction-specific peer token | Cursor, capacity and delivery state; no contents                                                  |
| `GET /api/project-sync/events?after=N` | Peer token                    | At most one bounded event after N                                                                 |
| `POST /api/project-sync/events`        | Peer token                    | Validate and durably apply `{event}`                                                              |
| `POST /api/project-sync/quota`         | Peer token                    | Authority reserves `{id, ownerUserId}` and returns a durable grant                                |
| `POST /api/project-sync/pull`          | Peer token                    | Reconcile `{status}`, acknowledge its verified receipt and return `{peer, events}`                |
| `POST /api/project-sync/seed`          | Separate admin token          | Capture one untracked or changed source Project                                                   |
| `POST /api/project-sync/run`           | Admin token                   | Reconcile and deliver one event; inspect returned status                                          |
| `POST /api/project-sync/compact`       | Admin token                   | Verify checkpoint positions and preview reclaimable bytes, or reclaim up to eight inactive events |

All responses are no-store. Browser cookies confer no synchronization authority.
Peer destinations are fixed HTTPS origins; redirects are refused. Identity token
equals the configured regional authority client secret, not a management token.
Credentials stay outside Git and release bundles. HTTP 409 blocks reconciliation,
503 pauses unavailable/fenced writes, and 507 signals journal backpressure.

Compaction accepts `{checkpoint: {cn, overseas}, dryRun}`. Each position has
`epoch`, `sequence` and the original event `hash`. A stream at zero uses
`hash: null`; an absent peer position uses `null`. Omit `dryRun` to preview.
`dryRun: false` applies one batch and reports the number of events and bytes
reclaimed. Extract the proof from the isolated restore in the
[regional runtime guide](../../containers/canvas-cn/formal/README.md#operating-rules).

## Acceptance criteria

- [Project HTTP tests](../../worker/regional-projects.test.ts) cover local save,
  restart, seed, history restore, global quota, concurrent heads, explicit
  resolution, retry and capacity rollback.
- [Fault tests](../../worker/regional-projects-faults.test.ts) cover bounded
  requests, invalid/gapped/colliding events, retained history and late updates
  after deletion.
- [Cohort tests](../../worker/regional-projects-cohort.test.ts) preserve
  nonparticipating overseas behavior and restrict domestic access and replication.
  [Pull tests](../../worker/project-sync-pull.test.ts) verify both directions,
  lost responses and restart when only the domestic region can initiate connections.
- [Historical-copy tests](../../worker/regional-projects-protection.test.ts)
  verify read-only domestic copies, overseas rejection of return mutations and
  unaffected source saves and separate test-Project synchronization.
- [Runtime entry test](../../worker/regional-entry.test.ts) uses actual authority
  and regional session stores to read and save a replicated Project locally.
- [Standalone candidate](../../containers/canvas-cn/formal/README.md) activation,
  real data reconciliation, off-host recovery, delivered monitoring alerts and
  browser login are deployment gates. Default Production configuration leaves
  regional features disabled.
