# Regional publications

Status: `proposed`

Primary owner: Gallery, Component Library and regional runtime.

Gallery, User Components and Dataset publications use origin-owned replicas.
[Private Projects](regional-projects.md) retain their separate two-writer protocol.

## Rules

- The publishing region alone edits, moderates, likes, withdraws, restores or
  deletes a resource. The other region serves a local read-only copy. Existing
  IDs, owners, retained versions and publication status survive copying.
- Dataset comparison figures/netlists, community reference images, reviews and
  fix history follow the same publication origin. Keep comparisons imported
  before a drawing and audit records retained after its deletion; seeding covers
  these identities too. Their existing visibility and blind-review rules remain.
- Aggregate byline maintenance, retention and automatic simulation checks operate
  only on locally published resources. A copied byline changes with its next
  publisher snapshot; a profile rename must not fail because foreign copies exist.
- Both regions can publish new resources. An incoming ID already belonging to
  local data is a collision, including unseeded historical data; refuse it without
  overwriting. Imported snapshots do not produce outbound changes.
- Source transactions atomically advance a durable change index. The index
  coalesces intermediate changes into the current resource snapshot and retains
  deletion markers. This is state replication, not a replayable business-event log.
- Each Community, Component and Dataset store has a separate epoch and cursor.
  A receiver accepts only the next response requested from its durable cursor.
  Repeated identical receipts are harmless; changed receipts, wrong streams,
  changed epochs, invalid hashes and out-of-order deliveries are refused.
- Resource snapshots contain only their allowlisted resource tables. Private
  Cloud Projects, sessions, credentials, live jobs and analytics are excluded.
  Matching schemas require the same named columns, independent of the physical
  column order left by migrations; missing or additional columns are incompatible.
  Existing resource permissions still govern access to copied private testbenches
  and hidden publications.
- A resource snapshot is limited to 24 MiB and 10,000 child rows per table.
  Oversized resources block their stream with an error; they are never truncated.
- Dataset records retain their source namespace and the
  [Gallery's mutation permissions](community-gallery.md). Imports and drawing
  fixes apply only at the publishing region; copied records remain read-only.
- Publication daily admission remains enforced by each region's existing API;
  it is not a globally reserved quota. Imported rows count in local admission
  after catch-up. Private Project quota coordination is unchanged.
- No remote request is required for ordinary reads or local publication. Sync
  retries in the background; a blocked stream stays visible in monitoring.
- Source restore runs with all publication writes closed. Reconcile peer cursors
  and current data before enabling writes; a lower source sequence or a different
  epoch is not repaired by resetting a receiver. Retain replication metadata and
  deletion markers with backups.
- Opt-in configuration leaves existing deployments unchanged. Snapshot seeding
  adds replication metadata; it does not rewrite resource content or owner IDs.
  Actual source activation and public DNS opening are separate delivery steps.

## Contract

The HTTP entrance is `/api/resource-sync/{stream}/{status|changes|seed}`.
Streams are `gallery`, `components` and the configured Dataset source keys.
Peer and seeding credentials are separate. Peer credentials grant replication
access only; browser sessions cannot use this entrance.

## Acceptance criteria

- Publish in either region, copy, restart, browse and reuse the same resource.
- Origin updates and deletions reach the copy; duplicate/stale deliveries cannot
  overwrite a local resource or resurrect an old copy.
- Dataset stores remain separate, and replication does not publish private
  Projects or copy login credentials.
- Offline catch-up, invalid delivery and metadata-preserving backup/restore pass
  before activation. The paired service monitor reaches caught-up, and independent
  alert delivery remains qualified.
