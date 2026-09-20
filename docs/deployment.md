# Deployment

## Development and delivery cadence

Production is the only hosted channel. Local work remains local until it is
delivered through a pull request; every merged non-documentation change is then
built for Production, deployed, verified, and rolled back if live verification
fails ([Deployment rationale](adr/deployment.md)). A `v*` tag or manual
`Deploy Cloudflare` dispatch may redeploy a selected commit that is already on
`main`.

Batching is optional: several changes may share one pull request, but a small
fix does not have to wait for others. Keep the current working list in
`plan/local-batch.md` when a batch is in progress, with the durable intent and
evidence in each commit and pull request.

Local commits do not publish the hosted site. A requested remote branch backup
also remains local-stage work. Review the combined risk of everything a pull
request carries. Documentation-only merges deploy nothing.

Each pull request receives one complete required CI pass. A current branch
merges directly after that pass; it does not enter a second merge-queue run. If
another change reaches `main` first, update the branch and rerun because the
candidate has changed. The required Core and Browser checks protect the merge;
Production's own verification and rollback protect the hosted release.

Prepare any release version before merging so the deployed candidate needs no
follow-up code change. See
[working rules](../AGENTS.md#development-and-delivery) and
[validation timing](testing/README.md#local-iteration-and-batch-validation).

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
the old data is exposed again.

Production builds a deployment candidate from the selected `main` commit using
`.github/actions/build-deployment-candidate`, verifies its source declaration
and file inventory, then deploys those exact bytes. The inventory uses file
counts and sizes; it does not calculate or compare SHA256 hashes. Runtime
bindings, routes, secrets, queues, buckets, and Durable Object namespaces are
applied by `wrangler.jsonc` rather than baked into the candidate.

The release build enables the Simulation and Agent workflows and sets
`VITE_ICM_SIMULATION_TRANSPORT=managed`. Digital Timing remains disabled in the
hosted build. Local and portable builds retain direct execution unless
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
the tracked host configuration. Verify its selected image and the measured
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
immutable input/result artifacts. Account ownership is preferred; Production can
issue an opaque HttpOnly anonymous capability. Capacity controls remain active
for the public service.

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
degraded. Follow the incident exception in [AGENTS.md](../AGENTS.md): use the
bounded recovery action needed, then record what was broken, what shipped, and
which checks were bypassed. A push to `main` starts a Production deployment;
verify that run rather than treating the push itself as recovery.
