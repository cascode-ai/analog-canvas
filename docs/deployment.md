# Deployment

How a release becomes the live site, what a merge to `main` becomes instead
(the preview), what protects production, and — the part worth reading twice —
what those protections do **not** cover.

## Today: deploy, verify, roll back

A release (a `v*` tag, or a manual dispatch naming a commit) deploys the
Worker, then verifies it against the running site: `/`, `/editor`, `/analytics`, the MCP manifest, and the stale-asset
fallback. If verification fails, the pipeline restores the version that was
serving before the deploy, verifies **that**, and fails the run anyway.

Three properties of that sequence are deliberate:

- **The rollback target is recorded before the deploy**, not after. Read
  afterwards, the "previous" version is the deploy under test.
- **A rollback is re-verified.** One that nobody checks is a second
  unverified deploy.
- **A successful rollback still fails the run.** Recovery is not a pass. A
  red run is how anyone finds out this happened.

When there is nothing to roll back to — a first-ever deploy — the pipeline
says a human is needed rather than reporting a recovery that did not happen.

### Why this exists

On 2026-09-01, `/editor` served 500s for about twenty minutes. The pipeline
was not blind to it: verification failed six times and the run went red. It
had no way to act, so production stayed broken until a person noticed.

The change that caused it passed all eight CI checks, and would again: it
changed `wrangler.jsonc`, which is Cloudflare routing configuration that CI
never executes. **A green CI run is evidence about the code, not about the
deployment.** That gap is why verification runs against the live site, and why
failing it now costs one verification round instead of an afternoon.

## What the rollback does not protect

The rollback restores a previous Worker **version**. Three things it does not
do, all learned on 2026-09-01 when it fired for the first time on real
traffic:

**A rollback does not undo a check that was wrong.** #519 made a missing
hashed asset answer 404, which is correct. The smoke check still required the
old shell-at-200 answer, so verification failed and the deploy was rolled
back — the machinery obeying a wrong instruction, perfectly. Every later
merge then hit the same check and rolled back too. When a change alters
behaviour a verification asserts, **the verification is part of the change**;
shipping one without the other blocks the pipeline for everyone.

**Repeated rollbacks do not return to a known state.** After three failed
deploys and three rollbacks, production was measured serving the NEW
behaviour: a missing chunk returned 404 with the Worker's own message. The
version selection after a previous rollback did not land where a reading of
the deployment list predicts, and the exact bookkeeping Cloudflare applies to
a rollback's own deployment entry was not established here. Treat "it rolled
back" as "a previous version is live", not as "the version you had before".
**Measure production after a rollback, every time.**

**A rollback does not undo bound resources.** Wrangler says so in its own
warning: Durable Objects, D1, R2 and KV are not restored. A deploy that
migrates data is not made safe by this protection.

None of that makes the rollback worthless — production stayed up through all
three failures, which is the whole point. It makes the rollback a way to keep
serving, not a way to be sure what you are serving.

## What CI cannot tell you

Anything that only exists at Worker runtime:

- `wrangler.jsonc` routing, bindings, and asset handling
- Durable Object namespaces and their migrations
- Environment variables and secrets present in the deployment
- The behaviour of the request path as Cloudflare actually runs it

For those, the live check after deploying is the only evidence.

## Release channels

[ADR 0057](adr/0057-release-channels-preview-and-production.md) defines two
channels built from one artifact: the **preview**, its own Worker at
`analog-canvas-preview.tokenzhang.com` configured by `wrangler.preview.jsonc`
and deployed by `.github/workflows/deploy-preview.yml` on every merge to
`main`; and **production**, which will deploy only from a release once the
preview is verified live. The preview is public but `noindex`, has no login,
reads the gallery through the public site's own API with no cookie, binds
no Durable Object of the production script, refuses every gallery and
Cloud Project write, and is where the simulation feature lands first. Nothing in the preview file inherits from
`wrangler.jsonc`, which is the whole point of it being a separate file. The
staging environment below is retired once production moves to release-only
deploys.

## Releasing to production

Every merge to `main` deploys the **preview** (`deploy-preview.yml`) and
verifies it, simulation included. Production deploys only from a release, and
the release workflow refuses a commit that has no successful preview deploy
behind it. Two ways to release a commit `<sha>` that the preview has proved:

```bash
git tag v0.3.0 <sha> && git push origin v0.3.0
```

```bash
gh workflow run "Deploy Cloudflare" -f sha=<sha>
```

A hotfix takes the same road: merge to `main`, let the preview deploy and
verify, tag that commit. Work on `main` that is not ready for the public
ships dark behind the channel flag (`ICM_CHANNEL`), never on a long-lived
branch.

The preview's simulator is configured in `wrangler.preview.jsonc` and not
yet in `wrangler.jsonc`; production gains it when a release carries that
configuration change, like any other.

### Where the simulator runs

The Worker never runs ngspice itself; it hands the deck to a harness over
HTTP (`worker/simulation.ts`). The harness is the image
`containers/ngspice/Dockerfile`, pinned to the benchmark base image by
digest, and it runs on **an operator-run host**, named by the var
`SIMULATION_UPSTREAM_URL`: Docker behind a Cloudflare Tunnel, so the host
opens no inbound port and its only public name is the tunnel's. It answers
`/run` only to the bearer token in its `SIMULATION_ACCESS_TOKEN`; the Worker
presents the same value from its secret `SIMULATION_UPSTREAM_TOKEN`, which
`deploy-preview.yml` sets from the repository secret of the same name on
every deploy.

Until 2026-09-04 the preview also bound a Cloudflare Container (`NGSPICE`,
one `standard-2` instance billed per second while awake) as a second,
explicitly selectable executor, and every deploy woke it to prove the two
agreed. It was a cold spare — switching to it meant editing the config and
redeploying — that cost about one GiB-hour per merge to keep verified, so
the owner had it removed (migration `v6` deletes the class). The Worker still
understands `executorTarget: "cloudflare-container"` and answers it "not
configured"; it never routes a request to another executor than the one
named. `execution.target` reports the transport that ran, and
`metadata.environment` identifies the image, simulator, and model bytes that
performed the run.

The current operator host is the Frankfurt machine, under its `analogcanvas`
account, in `~/analog-canvas-sim/`. Its desired state is not private machine
configuration: [`containers/ngspice/host/compose.yaml`](../containers/ngspice/host/compose.yaml)
is the sole definition of the harness container, tunnel container, internal
network, egress boundary, private run-root volume, restart policy, and resource
limits. The harness has a read-only root, no capabilities, bounded PIDs, 8 CPUs
and 16 GiB, no published host port, and no egress. `cloudflared` alone joins
both the internal network and an egress network.

The `Simulator host` workflow (`.github/workflows/simulator-host.yml`) copies
the exact tracked `containers/ngspice/` tree into a commit-addressed release on
the host. It writes the protected access token over SSH, runs the tracked
bootstrap/deploy scripts, and verifies `/health`; run by hand it can `probe`
what the Cloudflare token may do or `bootstrap-tunnel` — create or reuse the
named tunnel, its ingress, and DNS name, and hand the connector token to the
host without printing it. It reaches the host with `SIM_HOST_ADDR`,
`SIM_HOST_USER`, `SIM_HOST_SSH_KEY`, and `SIM_HOST_KNOWN_HOSTS`, and speaks to
Cloudflare with `CLOUDFLARE_TUNNEL_API_TOKEN` (Account → Cloudflare Tunnel:
Edit, Zone → DNS: Edit on the site's zone), separate from the deploy token.

No lifecycle script is operator-owned. A clean Docker-capable replacement can
be reconstructed from the repository and protected environment secrets by the
procedure in [`containers/ngspice/host/README.md`](../containers/ngspice/host/README.md).
The independent `containers/ngspice/verify-host-runtime.sh` still checks the
running result rather than trusting the Compose description. Automatic restart
is part of the Run Supervisor's fail-stop contract; without it a safe harness
exit would become a permanent outage. The host has 32 cores; the harness still
runs one job at a time, by its own slot, until the executor contract gains a
concurrency count.

`metadata.environment.executor` reads `hosted-container`: the harness is a
container image, and the fingerprint identifies it, not the machine
underneath. `execution.target` is the separate transport identity.

The preview's `/api/simulate` is open on purpose — no login, no rate limit,
no daily budget — by the owner's decision of 2026-09-04, after the cost
question went away with the Cloudflare Container: the host is the owner's
own machine, and the harness's isolation (an unprivileged account, a
read-only root, no network route, one slot, a deadline that kills the
process tree) is the whole boundary. Do not add an admission gate to the
preview's simulation without the owner asking for one.

### The retired staging environment

`env.staging` and the Worker-side access gate were retired by ADR 0057 after
the 2026-09-03 outage, when a staging deploy inherited the production custom
domain. **Deleting the configuration does not delete the deployed Worker.**
`interactive-circuit-maker-staging` keeps answering with its last build until
someone deletes it in the Cloudflare dashboard, which also discards the
`STAGING_ACCESS_KEY` secret that was set on it.

## When production is broken

Restoring service outranks the delivery route. Pushing straight to `main` is
allowed while the site is degraded, and so is any shortcut that shortens the
outage; `AGENTS.md` records this as a route rather than a violation, on one
condition: once service is back, the bypass gets a written record of what was
broken, what was pushed, and which checks were skipped.
