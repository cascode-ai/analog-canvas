# Deployment

## Channels and data isolation

| Channel    | Trigger and configuration                                                         | Data boundary                                                                                                                                  |
| ---------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Preview    | main push; `.github/workflows/deploy-preview.yml`; `wrangler.preview.jsonc`       | Own namespaces; anonymous HTTP read-through to public Gallery; public writes refused; private CI acceptance may use the isolated Project shelf |
| Production | `v*` tag or commit dispatch; `.github/workflows/cloudflare.yml`; `wrangler.jsonc` | Public product and its private storage                                                                                                         |

Preview is served at `analog-canvas-preview.tokenzhang.com`, labelled and
unindexed. Production is `analog-canvas.tokenzhang.com`. The separate
configuration files do not inherit routes or bindings. Preview has no
Production Durable Object binding, no Production cookies, and no configured
OAuth provider. Its simulation capability can be issued without OAuth; public
site access is not unrestricted compute authority.

The channels share source and contracts, not a guarantee of a single promoted
build artifact: the workflows build their selected checkout. Channel-controlled
features and runtime bindings may differ.
[ADR 0057](adr/0057-release-channels-preview-and-production.md) explains the choice.

The deployed cross-Project journey receives a repository secret as a
host-scoped HttpOnly cookie. Only `/api/projects` recognizes that identity, and
only when `ICM_CHANNEL=preview`; Gallery, account, moderation and Production
routes do not. The journey seeds one DUT Project in the Preview Worker’s own
GalleryDO, imports it through the public `project_cells` resource, runs the
resulting Testbench, preserves its receipt, and removes the seed. Missing or
incorrect credentials fail closed as the same 401/403 seen by an ordinary
visitor.

## Releasing to Production

Select a candidate commit that Preview has successfully deployed and verified.
The current Production workflow accepts **at least one successful
`deploy-preview.yml` run for that exact commit**. It does not select the latest
completed run, require the currently serving Preview to have that SHA, or
compare a separate Profile-qualified promotion receipt. Do not report those
stronger guarantees from this check.

Use either a version tag (choose the intended unused release version):

```bash
git tag v0.3.0 <sha>
git push origin v0.3.0
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
serving shell/editor/analytics, MCP manifest, and stale-asset handling. If the
check fails, it restores the recorded Worker version, verifies that result,
and still fails the deployment run. Without a rollback target, it reports that
human intervention is required.

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

Preview uses `/api/simulation/runs`. Its durable control object owns owner-bound
admission, idempotency, leases, cancellation, and bounded run records. Queue
dispatch sends work to the operator host's declared single slot; R2 holds
immutable input/result artifacts. Account ownership is preferred; Preview can
issue an opaque HttpOnly anonymous capability. Capacity controls remain active
for both.

`/api/simulate` remains the direct/internal contract and the explicit
Production/local transport until managed bindings are promoted. A managed
failure never triggers fallback to it. The local host has no automatic
simulator or PDK discovery.

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
