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
- `canvas-cn-release.py` installs releases; `maintenance.py` captures the
  stopped-state backup; `formal-backup.sh` invokes its daily handover;
  `scheduled-tick.py` runs Production's
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
   the source's `PROJECT_REGION_USERS`. Provision `project-sync-expansion`
   with `off` before the first release that embeds it. Start `project-compress-journal` at
   `false`. Enable it only under the [Project journal contract](../../../docs/specs/regional-projects.md#rules).
   `sync-alert.json` holds `apiKey`,
   `from` and the authorized recipient `to`.
3. `/etc/analog-canvas-operator/` holds `operator-key`, `known_hosts` and
   `ssh-config` (`Host canvas-operator` with its `HostName` and `User`). The key
   may only forward to the regional gateways; the address never enters Git.
4. Install `canvas-cn-release.py`, `canvas-cn-release.service` and its timer
   from a release once and enable the timer. From then on releases install
   themselves; their first install also enables the scheduled, release
   alert and formal backup timers. When upgrading from a runner that predates
   the formal backup timer, enable it once after its first install.
   Replication timers are enabled by an operator.

The browser entrance is `127.0.0.1:8082` (an SSH forward during the trial).
Public and trial nginx listeners forward business requests through the
independently installed `canvas-cn-ingress.service` on loopback port 8794.
Its root-accessible Unix control socket is never proxied publicly. Install
its pinned Node 24.22.1 Linux x64 runtime (archive SHA-256
`6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6`)
and `ingress.mjs` at `/opt/analog-canvas/ingress/ingress.mjs` before enabling
this release runner. Business deployments do not restart the entrance.
Bootstrap with the legacy release timer paused: start and verify the entrance,
reload nginx, and wait for all old nginx workers and their direct backend
connections to end before the first handover. Do not force a worker shutdown
deadline or assume reload moved an existing WebSocket to the new entrance.
Restore the release timer after the verified runner is installed.
Only successful content-hashed public build files bypass the Worker; retired
names return an uncached 404. No API or account response is cached there.

During handover the entrance holds at most 512 new requests for at most 15
seconds, never replays a sent request, and cancels handover if accepted ordinary
requests have not drained within 3 seconds. It then ends event streams and
WebSockets so their clients can reconnect to the same domestic entrance.
Before holding the entrance, allow running background ticks up to 90 seconds
to finish while the website keeps serving; otherwise defer the handover.
Release only queued requests after actual runtime readiness; genuine failures
remain failures. Record additional request waiting on the host as an observation,
not a 5-second release gate or an inference from a successful version update.
The Agent recovery target remains 10 seconds. Keep the bounded entrance hold and
readiness checks; do not repeat live restarts solely to meet a timing target.
An abandoned browser request still drains its accepted upstream operation.
An uncertain write response fences maintenance in
`/var/lib/canvas-cn-ingress/uncertain-write`, surviving entrance restarts;
reconcile the affected operation before deliberately clearing that marker and
restarting the entrance. Never clear it simply to allow a release.
The marker records only a timestamp and route category. Even an incomplete
upstream write may fence maintenance when acceptance cannot be ruled out;
nginx buffers incoming request bodies before forwarding. A fence reports an
`uncertain-write` release failure before any backup seed is prepared.
Paused background timers are recorded before stopping in
`/var/lib/canvas-cn-maintenance/paused.json`; recovery restores that exact set
after real runtime readiness, including an interrupted daily backup.

Keep `analog-canvas-origin.tokenzhang.com` on the overseas Worker. Pin the
Project and publication peers, `identity-url` and `transportOrigin` to that
host before splitting browser DNS. The release runner uses it by default.
Only the Auth contract's browser routes are proxied there in shared-domain mode.

The release owns the public nginx template. Use its release runner with
`--public-mode stage` to serve the canonical TLS certificate on loopback
port 8443 against the private runtime. At cutover set the shared-domain
origins and restart `canvas-cn-formal.service` to load them, then use
`--public-mode open --filing-number '京ICP备…号-1'`
with the issued number. Public HTTPS listens on IPv4 and IPv6 port 443.
The browser home page links that number to the MIIT site. `--public-mode off`
removes the public listener. Run these commands under the formal release lock
and keep public settings on the host. A release from before the public
template serves only the private listener.

When upgrading an already open IPv4-only host, reapply `--public-mode open`
with the current release runner and the existing filing number before adding
Hangzhou to mainland AAAA answers. Before removing the IPv6 listener, restore
the previous AAAA route and allow cached answers to expire.

## Host observations

`host_monitor.py` and `observations.py` ship in the verified regional release.
The existing `canvas-ops-monitor.timer` uses its existing state and mail
credential; releases update its unit without enabling another schedule. Its
service pins the verified source copy in sibling `monitor-releases/<commit>`,
outside the website release cleanup, so old installers cannot delete it on
rollback. New monitor installs retain two source versions. Failed installation restores the prior unit.
On the first upgrade from an installer without this unit support, install the
verified release's monitor sources and units under the release lock, using
its installer's `install_units` routine, then reload systemd. Keep the existing
schedule, credentials and notification history.

Observations include non-loopback TCP listeners and changes to the release's
runtime config, Worker bundle and sync service units (including overrides).
Only SSH and dual-stack HTTPS are expected on non-loopback addresses. These
checks report sustained drift after two minutes and never alter services,
ports or credentials. Listener checks do not prove firewall reachability;
public HTTPS must also be checked from outside the host. Only changed file
names and port numbers enter the monitor state, never configuration bodies.

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
- Project and Publication failure mail requires two minutes of unhealthy
  observations after the monitor detects an anomaly. A monitor report of
  blocked or disabled sync or journal capacity alerts at the next check,
  including escalation from an open incident with a less urgent report.
  An escalation waits in the delivery state during an unresolved send.
  Two minutes of healthy observations confirm recovery.
- Release mail reports failure and recovery at the next check. Retry must
  persist for two minutes before mail.
- All scopes report recovery after an accepted failure email. An open incident
  sends at most one reminder per hour. Uncertain sends reuse their idempotency
  key for up to 23 hours. Production separately alerts when the region stops
  pulling. Confirm test delivery before opening writes.
- Simulation reaches the regional gateways through `canvas-cn-operator`. Tunnel
  failure leaves editing and login available while computation fails closed;
  uncertain runs are never retried elsewhere. `simulation-smoke-token` only
  authorizes the deployment check on `/api/simulate`.
- The formal backup timer and release runner serialize snapshots with release
  installation. Seed a private incomplete copy while serving; it is not a backup.
  Pause scheduled and synchronization timers, wait for their active ticks, and
  hold the entrance before stopping the sole writer. Reconcile the copy with
  checksums and deletions while stopped, then start the selected release and
  verify it before resuming requests. There is one stop/start per handover.
  Daily backups use the release readiness budget. Restore paused timers as
  soon as requests resume, so restart reconciliation is not held behind
  compression. Cleanup failure must not skip timer restoration.
  Compress and publish the captured copy atomically after service resumes.
  Never restore data as part of a code rollback. An archive failure retains
  the incomplete capture and must not roll back an already healthy release.
  Keep the newest 20 local archives. Schedule the host's off-host file backup
  after the formal timer and restore from its completed archives under
  `/var/backups/analog-canvas-formal`. Check `state.sha256` before extracting.
  Restore into a separate directory and port, clear restored sessions
  and pending handoffs before connecting it to the authority. Follow
  [regional recovery](../../../docs/deployment.md#point-in-time-recovery)
  before exposing the restored instance. A release rollback retains the
  current state and must understand erased Project receipts once deletion is active.
- To reclaim Project journal bytes, verify the off-host archive digest and
  pass its isolated Gallery directory to
  `python3 containers/canvas-cn/formal/project-checkpoint.py` from the checkout root.
  Preview `POST /api/project-sync/compact` on each region with its admin token
  and the printed JSON. Set `dryRun` to `false` for bounded batches, ending
  when a batch returns zero events. Refresh the verified checkpoint as the
  journal grows. A restore must reach each live peer's compacted floor.

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

## Visitor statistics

Analytics replication is opt-in. Use the existing peer token to prepare the
source at `POST /api/analytics-sync/prepare`, then read its authenticated
`GET /api/analytics-sync/summary`. After verified backups, pass that summary
as `{summary}` to the region's admin-authenticated
`POST /api/analytics-sync/activate`. Activation freezes the local baseline and
starts durable collection; save `GET /api/analytics-sync/baseline` privately
before the first admin-authenticated `POST /api/analytics-sync/tick`.

After that tick succeeds and the existing statistics APIs agree, enable
`canvas-cn-analytics-sync.timer` and `canvas-cn-analytics-alert.timer`.
The monitor at `/var/lib/canvas-cn-analytics-sync/monitor.json` contains only
counters. Failed delivery keeps the immutable batch; do not advance its
acknowledgement or delete its queue. Alerting uses the existing mail service.
If the importer refuses historical data, preserve it and reconcile before
opening traffic; never discard the baseline to bypass the refusal.

The [analytics contract](../../../docs/specs/regional-analytics.md) owns
retention and recovery. After activation, rollback targets must understand
analytics collection and receipts. Never restore an old snapshot over live
counters or re-import it under a new stream identity.
