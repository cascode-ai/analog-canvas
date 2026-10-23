# Deployment

## Development and delivery cadence

Production (`analog-canvas.tokenzhang.com`, `.github/workflows/cloudflare.yml`,
`wrangler.jsonc`) is the only hosted channel ([rationale](adr/deployment.md)).
Local commits and pushed branches publish nothing. Every merged
non-documentation change is built, deployed, verified and, if live
verification fails, rolled back. Documentation-only merges deploy nothing.

A PR may carry one target or a related batch; review their combined risk. Each
PR enters the merge queue as soon as it opens. The queue runs the required
checks once on the candidate merged with current `main` (up to four at a time)
and squash-merges each pass. Update a branch by hand only for a real conflict.

Normal delivery:

1. Confirm scope, mainline base and release version. Start from
   `pnpm install --frozen-lockfile`; install Playwright Chromium once per
   machine/version.
2. Refresh the gate plan and preflight, run `pnpm verify:pr -- --base <base-ref>`
   and any unfulfilled affected/build/release obligations (build and release
   checks apply when rendering, export, Symbols or packaging can move). Final
   suites follow [validation timing](testing/README.md#validation-timing).
3. Write the PR with the original pr Summary / Evidence / Merge Danger template:
   before/after evidence, local results, pending queue and deployed checks.
4. Push, open/update the PR and queue the exact pushed SHA:
   `gh pr merge <number> --match-head-commit <pushed-sha>`.
5. On a failed check, inspect logs, repair, revalidate and queue again.
6. Inspect the deployment for the merge SHA and verify the changed live
   behavior. Close accepted tasks; close a parent only after its whole scope is
   accepted. Use PR references where auto-close would precede acceptance.

Prepare any release version before merging. Never weaken required checks to
finish; missing local evidence needs the corresponding remote results. Desktop,
MCP and simulator-host releases have their own acceptance.

## Releasing to Production

A merged change deploys its merge commit; so does a direct push to `main`
(only under [When Production is broken](#when-production-is-broken)). To
redeploy a commit already on `main`:

```bash
git tag v<version> <sha> && git push origin v<version>
gh workflow run "Deploy Cloudflare"            # current main
gh workflow run "Deploy Cloudflare" -f ref=<ref>
```

The workflow rejects a commit not on `main` and deploys the exact bytes it
built. The `ARENA` binding needs the `analog-arena` Worker
([AnalogArena](specs/analog-arena.md#routing)) to exist first; a Canvas
rollback does not touch it.

## Deploy, verify, recover

Production records its rollback target before deploying, then verifies served
entry bytes against the candidate (as brotli to a brotli client, never brotli
to a gzip client), shell/editor/analytics, public routes, MCP manifest,
stale-asset handling, one Agent session create/remove, and an OP/TRAN/DC/Noise
simulation smoke. If secret sync or verification fails it restores the recorded
Worker version, verifies it and still fails the run; without a rollback target
it reports that a human must intervene. The simulator token is required before
deploying.

A Worker revert does not revert Durable Objects, D1, R2, KV, data migrations
or the separately operated simulator: data changes need their own backup plan,
and after a rollback measure the serving version, bindings and simulator. Update
a verification assertion when its contract changes, or it rolls back correct
behavior.

### Assets across deploys

Each deploy publishes `/asset-history.json` (every served asset with the last
deploy that served it) and uploads, beside its own build, the earlier assets a
deploy served within 7 days (`scripts/retain-previous-assets.mjs`, at most 6000
files, which get no brotli sibling), so a tab opened before the deploy still
loads what it needs. A missing history or file is reported, never fatal; the
first deploy starts the history.

Only the deploy candidate, never `apps/editor/dist`, carries pre-compressed
brotli siblings, and only for its own build's compressible assets. A client
that accepts brotli gets a content-hashed asset from its sibling; every other
request is answered from the original as before
([worker/static-assets.ts](../worker/static-assets.ts)).

### Where the credentials live

Environment secrets are reachable only from `main` (and `v*` tags).

- `cloudflare-production`: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
  `GH_OAUTH_CLIENT_ID`, `GOOGLE_CLIENT_ID`, `GALLERY_BACKUP_TOKEN`,
  `STORE_BACKUP_TOKEN`, `SIMULATION_UPSTREAM_TOKEN`.
- `cloudflare-preview` (Simulator host and Preview retirement workflows):
  `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SIMULATION_UPSTREAM_TOKEN`,
  `SIM_HOST_SSH_KEY`, and `CLOUDFLARE_TUNNEL_API_TOKEN` (needed before
  `bootstrap-tunnel` or `vacask-preview`; the deploy token cannot manage
  tunnels or DNS).
- Worker-only runtime secrets: OAuth client secrets, `RESEND_API_KEY`,
  `AUTH_EMAIL_FROM`, `ADMIN_EMAILS`, `ADMIN_EMAILS_EXTRA`. The deploy sync
  skips names GitHub lacks. Change one by adding it to `cloudflare-production`
  and deploying, or `wrangler secret put <NAME>`.
- Repository secrets (not credentials): `SIM_HOST_ADDR`, `SIM_HOST_USER`,
  `SIM_HOST_KNOWN_HOSTS`. Rotate the host key: Simulator host workflow
  `authorize-ssh-key` with the new public key, store the private key in
  `SIM_HOST_SSH_KEY`, then `retire-ssh-key`.

### Point-in-time recovery

Cloudflare keeps 30 days of history for SQLite-backed Durable Objects. A
signed-in administrator can restore `gallery` (Gallery and all private Cloud
Projects), `accounts`, `analytics` or `components`:

1. `GET /api/admin/recovery?store=<store>&at=<ISO time>` returns that time's
   bookmark and the current one; it changes nothing.
2. Take a fresh [backup](gallery-backup.md): a restore discards everything
   after the bookmark.
3. `POST /api/admin/recovery` with
   `{ "store": "<store>", "bookmark": "<bookmark>", "confirm": "restore <store>" }`
   from the signed-in site's browser console (`await (await fetch(...)).json()`).
   It restarts the object and returns an `undoBookmark`; posting that bookmark
   the same way undoes the restore. `restarted: false` means armed but not
   applied until the next restart (a deploy): resend, or post the undo bookmark.

Restoring `accounts` revives sessions signed out after the bookmark and ends
later ones, the administrator's included. The local runtime answers
`recovery-unavailable`.

## Retained Preview data

Preview is retired and its domain detached, but its data (accounts, Projects,
Gallery, simulation state, R2, queues) is retained, unreachable, by the
route-free `wrangler.preview.jsonc` Worker that
`.github/workflows/retire-preview.yml` deploys and verifies. Never run
`wrangler delete`: it can make Durable Object data unrecoverable.
Reactivation is a deliberate migration, not ordinary delivery.

Removing repository configuration deletes no deployed Worker, secret, Durable
Object, bucket or queue. An authorized operator must still verify the
retirement of `interactive-circuit-maker-staging` and `STAGING_ACCESS_KEY`.
Never delete Production or retained Preview data while cleaning up.

## Where the simulator runs

The Worker forwards ngspice runs to `SIMULATION_UPSTREAM_URL` with
`SIMULATION_UPSTREAM_TOKEN`; the gateway's `SIMULATION_ACCESS_TOKEN` never
enters the executor, which
[`containers/ngspice/host/compose.yaml`](../containers/ngspice/host/compose.yaml)
keeps without credentials, host port or egress.

The [Simulator host workflow](../.github/workflows/simulator-host.yml) deploys
the host. Before a manual ngspice Docker build, run
`node scripts/package-ngspice-harness.mjs` after building workspace
dependencies. Collector changes need this host deployment as well as a Worker
deploy. After deploying verify `/health`: intended `limits.outputBytes` and
`limits.logBytes` (and matching public capabilities), image, measured
binary/model/startup identities and the `dependencies` cell-library digests
against the [hosted Profile](../containers/ngspice/hosted-sky130-profile.json).
The restart policy must recover a harness that exits because it cannot prove a
timed-out process is gone.

VACASK: the Profile named by `VACASK_PROFILE_ID` goes to `VACASK_UPSTREAM_URL`
with `VACASK_UPSTREAM_TOKEN`. The workflow's `vacask-preview` action builds it
from [`containers/vacask/host/compose.yaml`](../containers/vacask/host/compose.yaml)
as a separate stack and rotates the bearer into the Production Worker, leaving
ngspice untouched. Neither engine falls back to the other.

Production runs go through the managed `/api/simulation/runs` (signed-in
accounts only); `/api/simulate` is the direct/local transport and never a
fallback. Deploy smoke checks use a per-deploy `SIMULATION_SMOKE_TOKEN`.
[Simulation execution](specs/simulation-execution.md) owns the run contracts.

## When Production is broken

While service is actually degraded, restoring it outranks the normal route: use
a bounded recovery action, including a direct `main` push if it shortens the
outage, and verify the Production run it starts. Afterwards record what broke,
what shipped, which checks were bypassed and the follow-up verification in the
commit or PR.
