# Regional publications

Status: `proposed`

Primary owner: Gallery, Component Library and regional runtime.

Gallery, User Components and Dataset publications use origin-owned replicas;
their likes and reviews use writer-owned replicas.
[Private Projects](regional-projects.md) retain their separate two-writer protocol.

## Rules

- The publishing region alone edits, moderates, withdraws, restores or deletes
  a resource. The other region serves a local read-only copy. Existing IDs,
  owners, retained versions and publication status survive copying.
- Dataset comparison figures/netlists, community reference images and fix
  history follow the same publication origin. Keep comparisons imported before a
  drawing and audit records retained after its deletion; seeding covers these
  identities too.
- Either region likes or reviews any entry it serves. Each like
  (`entryId:userId`) and review (its ID) belongs to the region that last wrote
  it and travels in the store's `-interactions` stream; only that region unlikes
  it or resolves the review. A withdrawn like is re-claimed by whichever region
  writes it next; each claim raises the identity's generation, and a higher
  generation wins. Equal generations were written concurrently: both regions
  keep the overseas record. Blind-review visibility is unchanged.
- An interaction a region no longer owns keeps its place in that region's
  sequence as a no-op, so the receiver's cursor reaches the source tail.
- Likes and reviews that exist when interaction replication first starts are
  indexed in the same transaction; no seeding step is required for them.
- Deleting an entry or account removes only locally written likes and locally
  owned publications; the other region removes its own, and its likes stay
  hidden with their missing entry until then.
- Aggregate byline maintenance, retention and automatic simulation checks operate
  only on locally published resources. A copied byline changes with its next
  publisher snapshot; a profile rename must not fail because foreign copies exist.
- Both regions can publish new resources. An incoming publication ID already
  belonging to local data is a collision, including unseeded historical data;
  refuse it without overwriting. Imported snapshots do not produce outbound changes.
- Source transactions atomically advance a durable change index. The index
  coalesces intermediate changes into the current resource snapshot and retains
  deletion markers. This is state replication, not a replayable business-event log.
- Each Community, Component and Dataset store has separate publication and
  interaction epochs and cursors. A receiver accepts only the next response
  requested from its durable cursor. Repeated identical receipts are harmless;
  changed receipts, wrong streams, changed epochs, invalid hashes and
  out-of-order deliveries are refused.
- Snapshots are version 2; a receiver refuses any other version with 409
  `resource-version-unsupported`. Version 1 was never received in Production,
  so the two never mix.
- Resource snapshots contain only their allowlisted resource tables. Private
  Cloud Projects, sessions, credentials, live jobs and analytics are excluded.
  `gallery_entries.submitter_email` and `submitter_provider` never leave their
  region; a snapshot naming them is invalid and copies keep the column default.
  Owner IDs and private testbenches replicate; existing resource permissions
  still govern access to them and to hidden publications.
- Schemas match by table names and keys, independent of physical column order.
  A receiver accepts a snapshot whose columns are a subset of its own; absent
  columns take the local default. A column the receiver lacks blocks the stream
  with 409 `resource-schema-newer` without advancing its cursor; the same receipt
  applies after the receiver upgrades. Release overseas first, then China.
- A column migration recreates the replica guard and change triggers, so new
  columns are change-detected and read-only on copies. The previous release's
  replica statements keep working against this state, so a rollback can start;
  rolling forward again restores this release's triggers.
- Before import, each account ID in a snapshot's owner, component author, like
  and review columns is looked up at the identity authority
  ([Project identity checks](regional-projects.md#rules)) after the receipt is
  known to be new. An account the authority reports missing (since deleted) is
  imported and counted in stream status as `missingAccounts`; copied rows grant
  no authorization. An unavailable authority answers 503 and is retried; an
  answer naming another account blocks with 409 `unknown-owner`.
- A resource snapshot is limited to 24 MiB and 10,000 child rows per table.
  Oversized resources block their stream with an error; they are never truncated.
  Peer bodies may be gzip-encoded; limits apply to the inflated bytes.
- Dataset records retain their source namespace and the
  [Gallery's mutation permissions](community-gallery.md). Imports and drawing
  fixes apply only at the publishing region; copied records remain read-only.
- Publication daily admission remains enforced by each region's existing API;
  it is not a globally reserved quota. Imported rows count in local admission
  after catch-up. Private Project quota coordination is unchanged.
- No remote request is required for ordinary reads or local publication. Sync
  retries in the background; one blocked stream never stops the others and
  stays visible in monitoring.
- Source restore runs with all publication writes closed. Reconcile peer cursors
  and current data before enabling writes; a lower source sequence or a different
  epoch is not repaired by resetting a receiver. Retain replication metadata and
  deletion markers with backups.
- Opt-in configuration leaves existing deployments unchanged. Snapshot seeding
  adds replication metadata; it does not rewrite resource content or owner IDs.
  Actual source activation and public DNS opening are separate delivery steps.

## Contract

The HTTP entrance is `/api/resource-sync/{stream}/{status|changes|seed}`.
Streams are `gallery`, `components`, the configured Dataset source keys, and
`gallery-interactions` plus `{source}-interactions`. Peer and seeding
credentials are separate. Peer credentials grant replication access only;
browser sessions cannot use this entrance. Receiving requires
`PROJECT_IDENTITY_URL` and `PROJECT_IDENTITY_TOKEN`.

The China runner records each stream's `{status, reason, cursor}`; its health
is `error` while any stream is blocked and `caught-up` only when all are. Each
request may take 15 s plus 1 s per 256 KiB of payload, at most 120 s and the
remaining tick.

## Acceptance criteria

- Publish in either region, copy, restart, browse and reuse the same resource.
- Like and review an entry in either region; both regions show the same records.
- Origin updates and deletions reach the copy; duplicate/stale deliveries cannot
  overwrite a local resource or resurrect an old copy.
- Dataset stores remain separate, and replication does not publish private
  Projects, submitter contact details or login credentials.
- Offline catch-up, invalid delivery and metadata-preserving backup/restore pass
  before activation. The paired service monitor reaches caught-up, and independent
  alert delivery remains qualified.
