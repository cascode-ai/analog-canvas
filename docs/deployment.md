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
Cloud Project write, and is where the simulation container is bound first. Nothing in the preview file inherits from
`wrangler.jsonc`, which is the whole point of it being a separate file. The
staging environment below is retired once production moves to release-only
deploys.

## Releasing to production

Every merge to `main` deploys the **preview** (`deploy-preview.yml`) and
verifies it, container and all. Production deploys only from a release, and
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

The simulation container is bound on the preview (`wrangler.preview.jsonc`)
and not yet in `wrangler.jsonc`; production gains it when a release carries
that configuration change, like any other.

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
