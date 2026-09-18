# Deployment

## Development and publication cadence

Local work stays local until someone delivers it. Delivery is one pull request,
and its `preview` label chooses the channel
([Deployment rationale](adr/deployment.md)):

| Route      | Trigger                                          | What happens                                                                                                               |
| ---------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Local      | Commits on a local branch                        | `pnpm dev`, focused validation and an explanatory commit; nothing deploys                                                  |
| Production | Merge a pull request without the `preview` label | The merge commit is built once, deployed to Production, verified, and rolled back on failure; Preview is unchanged         |
| Preview    | Add the `preview` label to a same-repository PR  | Every push deploys the pull request's head to Preview; merging it deploys the merge commit to Preview only                 |
| Promotion  | `v*` tag or a Deploy Cloudflare dispatch         | A commit on `main` whose Preview deploy succeeded is deployed to Production from Preview's accepted candidate, not rebuilt |

Label a pull request `preview` when the change is large or risky, when a
collaborator needs to debug it on a hosted site, or when someone should click
through it before the public sees it. The label can be added or removed at any
time before merging; the route is read when the merge reaches `main`. An
unlabeled merge is the normal release for a small fix. Batching is optional:
several changes may share one pull request, but a small fix does not have to
wait for others. Keep the current working list in `plan/local-batch.md` when a
batch is in progress, with the durable intent and evidence in each commit and
pull request.

Local commits do not publish either site. A requested remote branch backup
also remains local-stage work. Review the combined risk of everything a pull
request carries. Documentation-only merges deploy nothing.

Each pull request receives one complete required CI pass. A current branch
merges directly after that pass; it does not enter a second merge-queue run. If
another change reaches `main` first, update the branch and rerun because the
candidate has changed. Preview selects hosted acceptance from the changed
paths. Ordinary editor work runs one published-MCP managed-engine smoke and one
GUI source journey in parallel. Agent, Simulation, simulator/netlist execution,
and deployment-boundary changes retain the complete qualification and product
journeys. Manual Preview runs are deep by default. An unlabeled merge skips
this hosted acceptance; only the required checks and Production's own
verification and rollback protect it.

Prepare any release version before merging, or before promoting a
Preview-accepted commit, so the deployed candidate needs no further code
change. See
[working rules](../AGENTS.md#three-stage-development-and-delivery) and
[validation timing](testing/README.md#local-iteration-and-batch-validation).

## Channels and data isolation

| Channel    | Trigger and configuration                                                                                               | Data boundary                                                                                                                                              |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preview    | `preview`-labeled PR or its merge, or manual dispatch; `.github/workflows/deploy-preview.yml`; `wrangler.preview.jsonc` | Own accounts and Projects; anonymous HTTP read-through to public Gallery; Gallery writes refused; private CI acceptance uses the same isolated Project API |
| Production | Unlabeled merge, `v*` tag, or manual dispatch; `.github/workflows/cloudflare.yml`; `wrangler.jsonc`                     | Public product and its private storage                                                                                                                     |

Preview is served at `analog-canvas-preview.tokenzhang.com`, labelled and
unindexed. Production is `analog-canvas.tokenzhang.com`. The separate
configuration files do not inherit routes or bindings. Preview has no
Production Durable Object binding or Production cookies. Human testers use a
Preview-only Google OAuth client; its consent-screen test-user roster controls
who can sign in. Its simulation capability can be issued without OAuth; public
site access is not unrestricted compute authority.

Both channels build deployment candidates with the same action,
`.github/actions/build-deployment-candidate`. A deploy builds the browser
assets and Worker bundle once and deploys those exact bytes. Preview stores its
candidate only after hosted acceptance succeeds; a promotion downloads that
candidate from the successful Preview run, checks its source commit and file
inventory, and deploys it without rebuilding. A direct release builds
its own candidate from the merge commit and checks it the same way. The inventory
uses file counts and sizes; it does not calculate or compare SHA256 hashes.
The artifact service owns archive integrity, so packaging does not repeat the
deployment check. Runtime
bindings, routes,
secrets, queues, buckets and Durable Object namespaces remain channel-specific;
they are applied by the destination Wrangler configuration rather than baked
into the candidate.
[Deployment rationale](adr/deployment.md) explains the choice.

The release build keeps the behavior of the deployed `main` commit.
The shared build action explicitly enables the Simulation and Agent workflows
on both channels, which serve the same browser capabilities:

| Browser capability                                               | Preview  | Production |
| ---------------------------------------------------------------- | -------- | ---------- |
| Core editor, project format, Gallery and account UI              | Enabled  | Enabled    |
| Analog Simulation workspace and Testbench authoring entry points | Enabled  | Enabled    |
| Agent connection controls                                        | Enabled  | Enabled    |
| Digital Timing UI                                                | Disabled | Disabled   |

These are browser presentation choices. Persisted Simulation data remains
round-trippable on both channels, and the Agent and Simulation HTTP APIs keep
their independently deployed contracts. The shared build also sets
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

The normal release is an unlabeled merge. The Production workflow reads the
merged pull request's labels, builds that merge commit once, and deploys it.
A merge labeled `preview` is skipped there and deployed to Preview instead. A
push to `main` without a pull request, as in the incident exception below,
also deploys directly. Runtime configuration, including the simulator gateway,
ships only when the deployed commit contains it.

To release a commit that Preview accepted, promote it. The Production workflow
first requires the commit to be on `main`, then selects the newest successful
`deploy-preview.yml` run for that exact commit and downloads its
`preview-candidate-<commit>` artifact: the same Worker bundle and browser asset
tree served during Preview acceptance. A promotion never substitutes the
latest branch build or rebuilds the selected source.

Use either a version tag (choose the intended unused release version):

```bash
git tag v<version> <sha>
git push origin v<version>
```

or the one-click manual promotion:

```bash
gh workflow run "Deploy Cloudflare"
```

The manual action defaults to the current `main` ref, so promoting the merge of
a labeled pull request requires no commit copy/paste. Its checkout resolves
that ref once and then requires the exact commit's accepted Preview artifact.
Supply `-f ref=<ref>` only when deliberately promoting another accepted tag or
merged commit. A labeled pull request's unmerged head can be debugged on
Preview but never promoted.

Before treating a release as validated, inspect the relevant required checks
and, for a promotion, the candidate's actual Preview evidence. Local unit
tests, build success, and recorded rawfiles cannot certify deployed bindings,
secrets, model identity, or the hosted request path.

## Deploy, verify, recover

Production records its rollback target **before** deployment. It verifies the
serving shell/editor/analytics, MCP manifest, and stale-asset handling. If a
post-deploy secret sync or verification fails, it restores the recorded Worker
version, verifies that result,
and still fails the deployment run. Without a rollback target, it reports that
human intervention is required.

Deep Preview acceptance runs the complete numerical, dual-engine, public
Agent/MCP, source-workspace GUI and private cross-Project journeys once; the
fast path runs only its two smoke journeys. Production verifies
that the served entry bytes match the deployed candidate, checks its public
routes and MCP manifest, creates and removes one lightweight Agent session, and
runs a baseline OP/TRAN/DC/Noise simulation smoke with Production bindings.
Preview's private cross-Project acceptance identity is never installed or
accepted on Production. The simulator token is required before deployment, and
each channel's managed queues and artifact bucket are reconciled independently.

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

Both hosted channels route the native VACASK Profile named by
`VACASK_PROFILE_ID` to a separate gateway at `VACASK_UPSTREAM_URL`, using each
Worker's `VACASK_UPSTREAM_TOKEN` secret. The Simulator host workflow's
historically named `vacask-preview` action builds that isolated candidate on the operator host from
[`containers/vacask/host/compose.yaml`](../containers/vacask/host/compose.yaml)
with its own Compose project, Tunnel and hostname, rotates the same gateway
bearer into the isolated Preview and Production Workers, and leaves the shared
ngspice stack unchanged; it does not deploy Worker code. The requested Profile
selects the engine, ngspice remains the default, and neither engine falls back
to the other.

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
ngspice operator gateway, which enforces its single execution slot. The local
host has no automatic simulator or PDK discovery.

[Simulation execution](specs/simulation-execution.md) owns queue, deadline,
retention, result, and error contracts. Neither managed retention nor browser
archives store run history in the Project.

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
