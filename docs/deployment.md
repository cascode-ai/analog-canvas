# Deployment

## Development and publication cadence

Use three stages so deployment work is paid per accepted batch rather than per
small edit:

| Stage | Unit of work | Completion |
| --- | --- | --- |
| Local | One bounded feature, fix, or improvement on the current local batch branch | Local feedback through `pnpm dev`, focused validation, and an explanatory local commit |
| Preview | At least 10 completed changes in one batch PR | Whole-batch delivery checks, required PR/merge-queue checks, one main merge, and hosted Preview acceptance |
| Production | A Preview-accepted candidate with release authorization | Version-tag or explicit-dispatch deployment and Production verification |

Ten changes means ten independently useful outcomes, not ten commits or files.
Supporting tests and follow-up repairs belong to their original change. Keep
the current working list and count in `plan/local-batch.md`, with the durable
intent and evidence in each commit and the batch PR. Continue the batch across
local tasks instead of opening a separate PR for each task. An explicit user
request may publish Preview earlier or hold the batch longer.

Local commits do not publish either site. A requested remote branch backup
also remains local-stage work. When the batch is ready, validate its combined
diff once for delivery and merge one PR; merging ten separate PRs would still
trigger repeated Preview deployments. Review the combined risk, including
interactions between otherwise small changes. Documentation-only work retains
the workflow's existing deployment exclusions.

Choose any release version while preparing the candidate for Preview. After
acceptance, Production publication is a separate release decision, covered by
the user's current or earlier authorization for that release. Neither the
change count nor Preview success automatically publishes Production. New local
work may accumulate in the next batch while the accepted Preview waits for a
Production release.

The existing deployment triggers below implement this cadence. See
[working rules](../AGENTS.md#three-stage-development-and-delivery) and
[validation timing](testing/README.md#local-iteration-and-batch-validation).

## Channels and data isolation

| Channel    | Trigger and configuration                                                         | Data boundary                                                                                                                                              |
| ---------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preview    | main push; `.github/workflows/deploy-preview.yml`; `wrangler.preview.jsonc`       | Own accounts and Projects; anonymous HTTP read-through to public Gallery; Gallery writes refused; private CI acceptance uses the same isolated Project API |
| Production | `v*` tag or commit dispatch; `.github/workflows/cloudflare.yml`; `wrangler.jsonc` | Public product and its private storage                                                                                                                     |

Preview is served at `analog-canvas-preview.tokenzhang.com`, labelled and
unindexed. Production is `analog-canvas.tokenzhang.com`. The separate
configuration files do not inherit routes or bindings. Preview has no
Production Durable Object binding or Production cookies. Human testers use a
Preview-only Google OAuth client; its consent-screen test-user roster controls
who can sign in. Its simulation capability can be issued without OAuth; public
site access is not unrestricted compute authority.

The channels share source and contracts, not a guarantee of a single promoted
build artifact: the workflows build their selected checkout. Channel-controlled
features and runtime bindings may differ.
[ADR 0057](adr/0057-release-channels-preview-and-production.md) explains the choice.

The release build keeps the accepted behavior at the promoted `main` commit.
Version 0.4.0 opens the previously Preview-only Simulation and Agent workflows
on Production. Both workflows declare their browser capabilities explicitly:

| Browser capability                                               | Preview  | Production |
| ---------------------------------------------------------------- | -------- | ---------- |
| Core editor, project format, Gallery and account UI              | Enabled  | Enabled    |
| Analog Simulation workspace and Testbench authoring entry points | Enabled  | Enabled    |
| Agent connection controls                                        | Enabled  | Enabled    |
| Digital Timing UI                                                | Disabled | Disabled   |

These are browser presentation choices. Persisted Simulation data remains
round-trippable on both channels, and the Agent and Simulation HTTP APIs keep
their independently deployed contracts. The workflows also set
`VITE_ICM_SIMULATION_TRANSPORT=managed`; local and portable builds retain direct
execution unless explicitly configured otherwise.

The deployed cross-Project journey receives a repository secret as a
host-scoped HttpOnly cookie. Only `/api/projects` recognizes that identity, and
only when `ICM_CHANNEL=preview`; Gallery, account, moderation and Production
routes do not. The journey seeds one DUT Project in the Preview Worker’s own
GalleryDO, imports it through the public `project_cells` resource, runs the
resulting Testbench, preserves its receipt, and removes the seed. Missing or
incorrect credentials fail closed as the same 401/403 seen by an ordinary
visitor.

Human Preview login uses this callback:

```text
https://analog-canvas-preview.tokenzhang.com/api/auth/google/callback
```

The `cloudflare-preview` GitHub environment supplies
`PREVIEW_GOOGLE_CLIENT_ID` and `PREVIEW_GOOGLE_CLIENT_SECRET`. Deployment maps
them to the Preview Worker's standard OAuth secret names when both are present.
Human login remains dark when neither is configured; a partial pair fails the
deployment. Preview's `AUTH` and `GALLERY` bindings are independent namespaces;
the same Google account may therefore use Preview and Production without
sharing sessions, internal user IDs, limits, or Projects. Preview Projects are
disposable test data and never synchronize or promote to Production.

## Releasing to Production

Select a candidate commit that Preview has successfully deployed and verified.
The current Production workflow accepts **at least one successful
`deploy-preview.yml` run for that exact commit**. It does not select the latest
completed run, require the currently serving Preview to have that SHA, or
compare a separate Profile-qualified promotion receipt. Do not report those
stronger guarantees from this check.

Use either a version tag (choose the intended unused release version):

```bash
git tag v0.4.0 <sha>
git push origin v0.4.0
```

or an explicit commit dispatch:

```bash
gh workflow run "Deploy Cloudflare" -f sha=<sha>
```

Ordinary merges do not trigger Production. Normal hotfixes use the same route;
the incident exception below is separate. Runtime configuration, including the
simulator gateway, ships only when the selected release contains it.

Before treating a release as validated, inspect the candidate's actual Preview
evidence and the relevant required checks. Local unit tests, build success, and
recorded rawfiles cannot certify deployed bindings, secrets, model identity, or
the hosted request path.

## Deploy, verify, recover

Production records its rollback target **before** deployment. It verifies the
serving shell/editor/analytics, MCP manifest, and stale-asset handling. If a
post-deploy secret sync or verification fails, it restores the recorded Worker
version, verifies that result,
and still fails the deployment run. Without a rollback target, it reports that
human intervention is required.

The Production workflow also runs the numerical, public Agent/MCP, and source
workspace GUI acceptance against the Production origin. These journeys use
browser-local fixture Projects and anonymous owned simulation runs. Preview's
private cross-Project acceptance identity is never installed or accepted on
Production. The simulator token is required before deployment, and each
channel's managed queues and artifact bucket are reconciled independently.

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
candidate and artifact hash; historical automated checklist ticks are not that
human evidence.

## Where the simulator runs

The Worker forwards to the configured operator gateway using
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

### Managed and direct transport

Both hosted channels use `/api/simulation/runs`. Each channel's durable control
object owns owner-bound admission, idempotency, leases, cancellation, and bounded run records. Queue
dispatch sends work to the operator host's declared single slot; R2 holds
immutable input/result artifacts. Account ownership is preferred; either channel can
issue an opaque HttpOnly anonymous capability. Capacity controls remain active
for both.

`/api/simulate` remains the direct/internal contract and the local transport.
A managed failure never triggers fallback to it. Production and Preview use
separate queues, control namespaces, and R2 buckets; both share the existing
operator gateway, which enforces its single execution slot. The local host has
no automatic simulator or PDK discovery.

[Simulation execution](specs/simulation-execution.md) owns queue, deadline,
retention, result, and error contracts. Neither managed retention nor browser
comparison stores run history in the Project.

## External resource retirement

Removing repository configuration does not delete a deployed Worker or secret.
The retirement status of `interactive-circuit-maker-staging` and its
`STAGING_ACCESS_KEY` must be verified by an authorized operator before declaring
external cleanup complete. It is not an accepted third channel. Do not delete
Production data while cleaning up a retired deployment.

## When Production is broken

Restoring service outranks the normal delivery route while service is actually
degraded. Follow the incident exception in [AGENTS.md](../AGENTS.md): use the
bounded recovery action needed, then record what was broken, what shipped, and
which checks were bypassed. Pushing main ordinarily deploys only Preview; it
does not by itself restore Production.
