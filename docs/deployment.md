# Deployment

## Development and delivery cadence

Production is the only hosted channel. Local work remains local until it is
delivered through a pull request; every merged non-documentation change is then
built for Production, deployed, verified, and rolled back if live verification
fails ([Deployment rationale](adr/deployment.md)). A `v*` tag or manual
`Deploy Cloudflare` dispatch may redeploy a selected commit that is already on
`main`.

Follow the [development workflow](development-workflow.md). One target or a
related batch may share a PR; scratch lists are optional and stay in ignored
`plan/`. Commits carry intent, validation and limitations. Local implementation
and Production acceptance are distinct completion boundaries.

Local commits do not publish the hosted site. A requested remote branch backup
also remains local-stage work. Review the combined risk of everything a pull
request carries. Documentation-only merges deploy nothing.

Each pull request enters the merge queue as soon as it is opened; its required
checks are skipped on the pull request itself. The queue runs them once, the
path-planned checks on the candidate merged with current `main`, up to four
candidates at a time, and squash-merges each one that passes. Nobody updates a branch by hand when another change reaches `main`
first; only a real conflict needs a manual update. The required Core and Browser
checks protect the merge; Production's own verification and rollback protect
the hosted release.

Before normal delivery:

1. Confirm the requested scope, mainline base and intended release version.
   Start from `pnpm install --frozen-lockfile`; install matching Playwright
   Chromium once per machine/version when needed.
2. Refresh the candidate's gate plan and preflight. Run `pnpm verify:pr -- --base
<base-ref>` and any unfulfilled affected/build/release obligations. Build and
   release checks apply when rendering, export, Symbols or packaging can move.
   Final original-suite checks follow [validation timing](testing/README.md#validation-timing).
3. Use original pr's Summary / Evidence / Merge Danger template. State before
   and after evidence, local results and pending queue/deployed verification.
4. Push the candidate, open/update its PR and immediately queue the exact pushed
   SHA with `gh pr merge <number> --match-head-commit <pushed-sha>`.
5. Wait for required checks and merge. On failure, inspect logs, repair,
   revalidate and queue again. Real conflicts need resolution; normal mainline
   movement alone does not require manual branch updates.
6. Inspect the deployment for that merge SHA and verify the changed live
   behavior. Close accepted tasks; a parent closes only after its whole scope
   is accepted. Use PR references where automatic closure would precede
   Production acceptance.

Prepare any release version before merging. Missing local evidence is reported
and requires corresponding remote results; required checks are not weakened
to complete delivery. Explicit local-only and branch-trial scope stops at its
requested boundary. Document-only changes with no deployment finish their
relevant document acceptance.

The local full-suite trial does not change queue jobs. Separate desktop, MCP or
simulator-host releases follow their own acceptance surfaces; a website merge
does not publish all of them.

## Hosted channels and retained Preview data

Production is served at `analog-canvas.tokenzhang.com` through
`.github/workflows/cloudflare.yml` and `wrangler.jsonc`.

The hosted Preview channel was retired on 2026-09-20. Its former domain,
`analog-canvas-preview.tokenzhang.com`, is intentionally detached and offline.
The retirement is reversible at the storage boundary:

- `wrangler.preview.jsonc` keeps the existing Preview Worker's Durable Object
  migrations and bindings plus its R2 binding, but defines no route, asset
  site, workers.dev URL, scheduled trigger, or queue consumer.
- Preview accounts, Projects, Gallery/Auth state, simulation control state,
  the R2 bucket, and both queue resources are retained. They are not reachable
  through a hosted application and do not synchronize to Production.
- `.github/workflows/retire-preview.yml` deploys that dormant storage
  authority, detaches only the exact Preview custom domain, and verifies the
  retained Worker, bucket, and queues. Do not use `wrangler delete`: deleting
  the script can make its Durable Object data irrecoverable.

Reactivating Preview is a deliberate future migration, not part of ordinary
delivery. It requires restoring a public route and assets, queue bindings,
credentials, current application compatibility, and hosted verification before
the old data is exposed again. The Worker code no longer has a Preview mode
(the channel endpoint, the read-only Gallery read-through and the private
acceptance identity were removed on 2026-10-06), so a reactivation also
restores whatever isolation from Production it needs.

Production builds a deployment candidate from the selected `main` commit using
`.github/actions/build-deployment-candidate`, verifies its source declaration
and file inventory, then deploys those exact bytes. The inventory uses file
counts and sizes; it does not calculate or compare SHA256 hashes. Runtime
bindings, routes, secrets, queues, buckets, and Durable Object namespaces are
applied by `wrangler.jsonc` rather than baked into the candidate.

The release build enables the Simulation and Agent workflows and sets
`VITE_ICM_SIMULATION_TRANSPORT=managed`. Digital Timing is retired from the
Editor runtime in every environment; this does not affect saved clock symbols.
Bundled example Projects load only on loopback hosts; hosted Gallery entries
continue to come from the Gallery service.
Local and portable builds retain direct execution unless
explicitly configured otherwise.

## Releasing to Production

The normal release is a merged non-documentation change on `main`. The
Production workflow builds that exact merge commit once and deploys it. A push
to `main` without a pull request, as in the incident exception below, also
deploys directly. Runtime configuration, including the simulator gateway,
ships only when the deployed commit contains it.

Use either a version tag (choose the intended unused release version):

```bash
git tag v<version> <sha>
git push origin v<version>
```

or the one-click manual release:

```bash
gh workflow run "Deploy Cloudflare"
```

The manual action defaults to the current `main` ref. Supply `-f ref=<ref>` only
when deliberately releasing another tag or merged commit. The workflow rejects
any selected commit that is not already on `main`.

Before treating a release as validated, inspect the required checks and the
Production deployment result. Local unit tests, build success, and recorded
rawfiles cannot certify deployed bindings, secrets, model identity, or the
hosted request path.

## Deploy, verify, recover

Production records its rollback target **before** deployment. It verifies the
serving shell/editor/analytics, MCP manifest, and stale-asset handling. If a
post-deploy secret sync or verification fails, it restores the recorded Worker
version, verifies that result,
and still fails the deployment run. Without a rollback target, it reports that
human intervention is required.

Production verifies that the served entry bytes match the deployed candidate,
checks its public routes and MCP manifest, creates and removes one lightweight
Agent session, and runs a baseline OP/TRAN/DC/Noise simulation smoke with
Production bindings.
The simulator token is required before deployment, and Production's managed
queues and artifact bucket are reconciled independently.

Recovery limitations:

- Reverting a Worker does not revert Durable Objects, D1, R2, KV, or their data
  migrations. Data changes require their own backup and recovery plan.
- A successful rollback check is not proof that every binding or executor
  returned to its prior state. Measure the serving version and behavior.
- A stale verification assertion can roll back correct behavior. Change the
  verification deliberately when its accepted contract changes.
- Worker recovery does not recover the separately operated simulator. Verify
  and restore its desired state independently.

### Where the credentials live

Since 2026-10-07 the deployment credentials are environment secrets, which only
`main` (and, for Production, `v*` tags) can reach; a pushed branch cannot read
them.

- `cloudflare-production`: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
  `GH_OAUTH_CLIENT_ID`, `GOOGLE_CLIENT_ID`, `GALLERY_BACKUP_TOKEN`,
  `STORE_BACKUP_TOKEN`, `SIMULATION_UPSTREAM_TOKEN`.
- `cloudflare-preview` (the Simulator host and Preview retirement workflows):
  `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SIMULATION_UPSTREAM_TOKEN`.
- The OAuth client secrets, `RESEND_API_KEY`, `AUTH_EMAIL_FROM`,
  `ADMIN_EMAILS` and `ADMIN_EMAILS_EXTRA` exist only as Worker runtime
  secrets; the deploy's sync skips a name GitHub does not hold, which keeps
  the Worker's value. To change one, add it to `cloudflare-production` and
  deploy, or run `wrangler secret put <NAME>`.
- `SIM_HOST_SSH_KEY`, the CI's key to the simulator host, belongs in
  `cloudflare-preview`. The host's address, user and host key
  (`SIM_HOST_ADDR`, `SIM_HOST_USER`, `SIM_HOST_KNOWN_HOSTS`) are not
  credentials and stay repository secrets. To replace the key, run the
  Simulator host workflow's `authorize-ssh-key` with the new public key, put
  the new private key in `SIM_HOST_SSH_KEY`, then run `retire-ssh-key`.
- `bootstrap-tunnel` and `vacask-preview` runs need a
  `CLOUDFLARE_TUNNEL_API_TOKEN` in `cloudflare-preview` first; the deploy token
  cannot manage tunnels or DNS.

### Point-in-time recovery

Cloudflare keeps 30 days of history for every SQLite-backed Durable Object.
The Worker exposes it for the stores that hold durable data — `gallery` (the
Gallery and every private Cloud Project, one object), `accounts`, `analytics`
and `components` — to a signed-in administrator only:

1. `GET /api/admin/recovery?store=<store>&at=<ISO time>` answers the bookmark
   for that time and the current one. It changes nothing.
2. Take a fresh [backup](gallery-backup.md) of whatever must survive: a restore
   discards everything the store recorded after the bookmark.
3. `POST /api/admin/recovery` with
   `{ "store": "<store>", "bookmark": "<bookmark>", "confirm": "restore <store>" }`
   arms the restore, restarts the object so it applies, and answers an
   `undoBookmark` (kept even when the object is slow to come back). Posting
   that bookmark the same way undoes the restore. `restarted: false` means the
   restore is armed but the object did not restart, so it would apply at the
   next unrelated restart (a deploy): send the same request again, or post the
   undo bookmark to cancel it. There is no button: send it
   from the signed-in site's browser console, for example
   `await (await fetch("/api/admin/recovery", { method: "POST", body: JSON.stringify({ store: "gallery", bookmark: "…", confirm: "restore gallery" }) })).json()`.

Rolling `accounts` back also revives sessions signed out since the bookmark and
ends sessions started after it, the administrator's own included; sign in
again to continue. The local runtime keeps no such history; it answers
`recovery-unavailable`.

Manual portable-release acceptance must also establish PWA installation and an
original import/place/wire/save/restart/restore/export journey. Record the
candidate version and source commit; historical automated checklist ticks are
not that human evidence.

## Where the simulator runs

The Worker forwards ngspice runs to the configured operator gateway using
`SIMULATION_UPSTREAM_URL` and its secret `SIMULATION_UPSTREAM_TOKEN`.
The gateway validates its matching `SIMULATION_ACCESS_TOKEN`; that token never
enters the executor that runs authored SPICE. The container image is defined by
[`containers/ngspice/Dockerfile`](../containers/ngspice/Dockerfile).

[`containers/ngspice/host/compose.yaml`](../containers/ngspice/host/compose.yaml)
owns the gateway, untrusted executor, Tunnel, internal/egress networks, private
run volume, restart policy, and resource limits. The executor has a read-only
root, no platform credentials, no published host port, and no egress.
Only the gateway receives the bearer. The Tunnel connects the internal service
to its public hostname without an inbound host port.

The [Simulator host workflow](../.github/workflows/simulator-host.yml) deploys
the tracked host configuration. It builds the shared ngspice result runtime with
`node scripts/package-ngspice-harness.mjs` after building workspace dependencies,
and ships the generated `containers/ngspice/runtime/entrypoint.mjs` with the image
context. Run that packaging command before a manual ngspice Docker build too.
Changes to the collector require this host deployment as well as Worker deployment;
publishing the website alone does not change an already-running collector.
Verify `/health` reports the intended `limits.outputBytes` and `limits.logBytes`,
and verify public capabilities reflect that running waveform limit.
Verify its selected image and the measured
binary/model/startup identities against the
[hosted Profile](../containers/ngspice/hosted-sky130-profile.json), not just a
reachable health endpoint. The restart policy must recover a harness that exits
because it cannot prove a timed-out process is gone.

`metadata.environment.executor` describes the measured container environment;
`execution.target` identifies transport. A request naming an unconfigured
executor is refused, not redirected.

Production routes the native VACASK Profile named by
`VACASK_PROFILE_ID` to a separate gateway at `VACASK_UPSTREAM_URL`, using the
Worker's `VACASK_UPSTREAM_TOKEN` secret. The Simulator host workflow's
historically named `vacask-preview` action builds that isolated candidate on the operator host from
[`containers/vacask/host/compose.yaml`](../containers/vacask/host/compose.yaml)
with its own Compose project, Tunnel and hostname, rotates the same gateway
bearer into the Production Worker, and leaves the shared ngspice stack
unchanged; it does not deploy Worker code. The requested Profile
selects the engine, ngspice remains the default, and neither engine falls back
to the other.

### Managed and direct transport

Production uses `/api/simulation/runs`. Its durable control object owns
owner-bound admission, idempotency, leases, cancellation, and bounded run records. Queue
dispatch sends work to the operator host's declared single slot; R2 holds
immutable input/result artifacts. Since 2026-10-08 every run belongs to a
signed-in account: a signed-out request to either route is answered `401`
`simulation-authentication-required` ("Sign in to run simulations."), and no
anonymous session is issued. Discovering the Profiles
(`{"operation":"capabilities"}`) stays open. The deploy's own simulation checks
send a `SIMULATION_SMOKE_TOKEN` that each deploy makes, masks, puts in the
Worker and the next deploy replaces. Capacity controls remain active.

`/api/simulate` remains the direct/internal contract and the local transport.
A managed failure never triggers fallback to it. Production uses its own queue,
control namespace, and R2 bucket with the existing ngspice operator gateway,
which enforces its single execution slot. The local host has no automatic
simulator or PDK discovery.

[Simulation execution](specs/simulation-execution.md) owns queue, deadline,
retention, result, and error contracts. Neither managed retention nor browser
archives store run history in the Project.

## External resource retirement

Removing repository configuration does not delete a deployed Worker, secret,
Durable Object, bucket, or queue. Preview is intentionally dormant rather than
deleted so its data remains recoverable. The retirement status of
`interactive-circuit-maker-staging` and its `STAGING_ACCESS_KEY` must still be
verified by an authorized operator; staging is not an accepted channel. Do not
delete Production or retained Preview data while cleaning up retired entrances.

## When Production is broken

Restoring service outranks the normal delivery route while service is actually
degraded. Use a bounded recovery action, including a direct main push when it
shortens the outage. After restoration, record what was broken, what shipped,
which checks were bypassed and subsequent verification in the follow-up commit
or PR. This exception applies to actual degraded service, not ordinary urgency.
A push to `main` starts a Production deployment;
verify that run rather than treating the push itself as recovery.
