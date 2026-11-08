# China regional runtime

The China region runs Production's release on one host under the pinned
workerd ([standalone runtime](../README.md)), implementing the
[Project contract](../../../docs/specs/regional-projects.md),
[publication replicas](../../../docs/specs/regional-resources.md) and
[regional sessions](../../../docs/specs/regional-login.md). Delivery rules are
in [China region](../../../docs/deployment.md#china-region); this file owns the
host.

## Files

- `config.capnp`, `canvas-cn-scheduled.timer` and the credential block of
  `canvas-cn-formal.service` are generated from `region.jsonc`; never edit
  them by hand.
- `canvas-cn-release.py` installs releases; `formal-backup.sh` takes the
  stopped-state backup it runs first; `scheduled-tick.py` runs Production's
  scheduled work; `sync-tick.py`, `resource-sync-tick.py` and `sync-alert.py`
  drive and watch replication. Each has a Python test beside it.
- Namespace keys in `region.jsonc` and state paths are persistent identities.
  One process owns a state directory; never start two writers on it.

## One-time host setup

1. Users `canvas-formal` and `canvas-operator`; the pinned workerd at
   `/opt/analog-canvas/runtime/workerd-2026-09-11` (hash in the standalone
   README); nginx including `nginx.conf` as
   `/etc/nginx/conf.d/analog-canvas-formal.conf`.
2. Root-owned credential files in `/etc/analog-canvas-formal`, one per name in
   the service's generated `LoadCredential` block, written without a trailing
   newline. `project-writes-enabled` and `resource-writes-enabled` contain
   exactly `true` or `false`. Inbound,
   outbound and admin synchronization tokens are separate; the opposite region
   uses the inbound token for its delivery. `regional-client.json` follows the
   Auth contract and its secret equals `identity-token`.
   `project-region-users.json` lists the confirmed cohort, the same list as
   the source's `PROJECT_REGION_USERS`. Start `project-compress-journal` at
   `false`. Enable it only under the [Project journal contract](../../../docs/specs/regional-projects.md#rules).
   `sync-alert.json` holds `apiKey`,
   `from` and the authorized recipient `to`.
3. `/etc/analog-canvas-operator/` holds `operator-key`, `known_hosts` and
   `ssh-config` (`Host canvas-operator` with its `HostName` and `User`). The key
   may only forward to the regional gateways; the address never enters Git.
4. Install `canvas-cn-release.py`, `canvas-cn-release.service` and its timer
   from a release once and enable the timer. From then on releases install
   themselves; their first install also enables the scheduled and release
   alert timers. Replication timers are enabled by an operator.

The browser entrance is `127.0.0.1:8082` (an SSH forward during the trial).
Keep `analog-canvas-origin.tokenzhang.com` on the overseas Worker. Pin the
Project and publication peers, `identity-url` and `transportOrigin` to that
host before splitting browser DNS. The release runner uses it by default.
Only the Auth contract's browser routes are proxied there in shared-domain mode.

## Operating rules

- The release monitor is `/var/lib/canvas-cn-release/monitor.json`. To retry
  a refused commit after fixing its cause (usually a missing credential),
  delete that state file.
- Rate limits use nginx's client address; behind the SSH trial entrance every
  browser shares one address and therefore one allowance.
- Project sync fails a tick on `retry`, `blocked`, `disabled`, a remaining write
  fence, 120 seconds without catch-up, or 80% of the journal budget; its
  monitor holds counters only. The region pulls and pushes; the source needs no
  inbound domestic URL. The sync service never starts a stopped runtime.
- Alerts: `sync-alert.py` watches Project, Publication and Release. Mail for
  `retry` requires consecutive observations over two minutes. Other failures
  and stale monitors alert at the next check. Repeat failure mail is at most
  hourly, and recovery mail follows a failure accepted by the mail service.
  Uncertain sends reuse their idempotency key for up to 23 hours. Production
  separately alerts when the region stops pulling. Confirm `--test` delivery
  before opening writes.
- Simulation reaches the regional gateways through `canvas-cn-operator`. Tunnel
  failure leaves editing and login available while computation fails closed;
  uncertain runs are never retried elsewhere. `simulation-smoke-token` only
  authorizes the deployment check on `/api/simulate`.
- Backups stop the runtime briefly and keep the newest 20 snapshots of state,
  sessions, journals, receipts and artifact storage. Copy verified archives
  off host. Restore into a separate directory and port, clear restored sessions
  and pending handoffs before connecting it to the authority. Follow
  [regional recovery](../../../docs/deployment.md#point-in-time-recovery)
  before exposing the restored instance. A release rollback retains the
  current state and must understand erased Project receipts once deletion is active.

## Publication replicas

Publication replication is opt-in on each side. On the source set
`RESOURCE_REGION=overseas`, the separate peer and admin tokens and
`RESOURCE_WRITES_ENABLED=true`; a code push enables none of them.

- Seed Community, Components, every configured Dataset source and each
  store's interaction stream through the admin-authenticated HTTP entrance
  until each answers `more=false`. Seeding
  adds change metadata only. A later snapshot-schema expansion backfills
  already tracked resources explicitly; never clear metadata or cursors.
- The private `resource-sync.json` names `localOrigin`, `peerOrigin`,
  `localTokenFile` and `peerTokenFile` (owned `root:canvas-formal`, mode
  `0640`). Only loopback may use HTTP; the runner refuses redirects and checks
  region, stream, cursor and payload hash.
- Enable the publication timer after both peers are configured, reach
  caught-up and compare IDs, owners, status and content before opening
  domestic publication writes. A failed stream is never skipped by advancing
  its cursor.

The [Project contract](../../../docs/specs/regional-projects.md) owns
journal retention, abandoned quota reservations and regional recovery.
