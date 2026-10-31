# China standalone runtime

Private, single-host acceptance profile. This directory owns the standalone
process and its backup boundary; it is not an overseas release or a public
production login configuration. The [regional identity and synchronization
contract](../../docs/specs/china-regional-identity-sync.md) is not implemented.

- Build the unchanged Canvas Worker with an isolated Wrangler configuration
  and `deploy --dry-run`. Place its module at `worker/index.js` beside
  `config.capnp`; serve built editor assets through the loopback Nginx entry.
- Use workerd `1.20260911.1`, Linux x64 binary SHA-256
  `caf8ce67240e4349e50c839cd06b29b6eea6ff3867ade44ce1b287649f282242`.
  Refuse a different binary before activation. Runtime upgrades are explicit
  migrations with backup/restore and rollback checks, not package auto-updates.
- `config.capnp` and the systemd unit are the source of truth for bindings,
  namespace identities, addresses and resource limits. One process owns a
  state directory. A second process, including restore tests, needs its own
  directory and port. Never start two writers against the same SQLite files.
- The configured namespace identities preserve the private replica's IDs.
  A migration copies a stopped replica's `state/v3/do` to the native `state`
  directory. Keep the replica snapshot and reject changes if account and
  Project IDs, revisions, history or content digests differ after migration.
- Global outbound fetch is refused and systemd also restricts network access
  to loopback. There is no remote credential, production queue, Arena binding,
  scheduled production job or simulation artifact bucket in this profile.
  Those capabilities require their own adapters and acceptance before enabling.
- The synthetic Owner and loopback test-login page are acceptance-only. Real
  accounts use a separate dataset and verified login; public rollout must
  remove the bypass and supply production authorization configuration.

## Backup and rollback

`backup.sh` runs as root and serializes maintenance through
`/run/lock/canvas-cn-native.lock`. It briefly stops the native service, captures
all owned SQLite files consistently, restarts it and preserves the pinned
binary and release beside the snapshot. This is an explicit maintenance pause,
not an online backup or a high-availability claim.

Install it as `/usr/local/share/analog-canvas/native-backup.sh`. The timer is
for private acceptance; public service needs an agreed maintenance/RPO policy.
Snapshots are private and contain test-session material. Local snapshots alone
are not disaster recovery: copy verified archives off host and restore the
received bytes into a separate directory and process. Automatic off-host
delivery and retention are rollout gates, not provided by this timer.

Validate restored data through authenticated Project/history/Gallery reads and
content digests, not only SQLite integrity. Verify failed-process recovery,
background alarms, WebSocket reconnection and anonymous-write rejection on the
deployed candidate. Alarm recovery after process loss is a separate gate from
an alarm that fires while the process stays up.

Before activation, record both releases and snapshots. Stop the writer before
changing state; a rollback preserves every newly acknowledged write. An older
service may reuse that state only after compatibility is proved; otherwise
freeze writes and reconcile. Do not roll back by silently selecting the older
replica's stale directory. Overseas service and DNS are outside this operation.

## Production gates

The pinned [workerd schema](https://github.com/cloudflare/workerd/blob/v1.20260911.1/src/workerd/server/workerd.capnp)
marks `localDisk` experimental. Standalone deployment therefore requires
version pinning and exercised logical recovery, not a claim of Cloudflare's
managed durability or multi-region behavior. The [runtime supports systemd
deployment](https://github.com/cloudflare/workerd#serving-in-production).

Before public operation: qualify the required alarms and periodic maintenance,
Agent artifact storage, bounded sustained load, off-host retention and restore,
delivered external alerts, actual identity and synchronization, simulation
admission, HTTPS and regional routing. Secrets remain outside release bundles
and Git; status checks and logs must not contain session/claim material.
