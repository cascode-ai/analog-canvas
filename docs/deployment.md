# Deployment

How a merge to `main` becomes the live site, what protects it, and — the part
worth reading twice — what those protections do **not** cover.

## Today: deploy, verify, roll back

A push to `main` deploys the Worker, then verifies it against the running
site: `/`, `/editor`, `/analytics`, the MCP manifest, and the stale-asset
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

## What CI cannot tell you

Anything that only exists at Worker runtime:

- `wrangler.jsonc` routing, bindings, and asset handling
- Durable Object namespaces and their migrations
- Environment variables and secrets present in the deployment
- The behaviour of the request path as Cloudflare actually runs it

For those, the live check after deploying is the only evidence.

## Planned: staging before production

A staging environment (`env.staging` in `wrangler.jsonc`) deploys first, gets
the same verification, and promotes to production when it passes. It is not
yet in place; it needs Cloudflare account changes, and the owner requires the
staging hostname to be private and login-gated so it is never mistaken for the
product.

**Promotion is automatic by default, and manual when the version changes.**
An ordinary merge flows through staging to production without anyone waiting;
a version bump stops at an approval gate.

### The limit to state plainly

**Staging's Durable Object namespaces are empty.** They bind to the Worker
script name, so a separate script gets separate, empty storage — no gallery
entries, no accounts, no agent sessions. That is good for safety: staging
cannot touch real data.

It also means staging proves less than it appears to:

- It **does** catch "the site does not come up", which is exactly the class of
  failure that caused the 2026-09-01 outage.
- It **does not** catch "this particular circuit breaks when opened", or any
  defect that needs real accounts, real gallery entries, or real sessions to
  reproduce.

Passing staging is evidence that the deployment is viable, never that the
change is correct. The production verification and the rollback remain the
protection that matters for everything staging cannot see.

### Simulation is not enabled on staging

The ngspice container is deliberately absent there. Container time is billed
per environment, and a broken simulation route does not take the site down.
Staging verifies only that the route exists and refuses correctly — which is
what the route does when no container is bound.

## When production is broken

Restoring service outranks the delivery route. Pushing straight to `main` is
allowed while the site is degraded, and so is any shortcut that shortens the
outage; `AGENTS.md` records this as a route rather than a violation, on one
condition: once service is back, the bypass gets a written record of what was
broken, what was pushed, and which checks were skipped.
