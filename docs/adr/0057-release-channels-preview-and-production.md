# 0057 - Release channels: preview and production

Status: `accepted`

Date: `2026-09-04`

Owners: `worker`, `.github/workflows`, `apps/editor`, `docs/deployment.md`

## Context

Merging to `main` deployed straight to the public site. The owner wants to
ship a large version and the simulation feature (ADR 0055) somewhere people
can try them first, and promote to the public site only after looking.

The first attempt at a pre-production environment, `env.staging` in
`wrangler.jsonc` with an access gate inside the Worker, caused the outage of
2026-09-03: wrangler's `routes` key inherits into an environment, so a
staging deploy attached the production custom domain to the staging script,
and the public site answered every script request with the gate's 401 while
its cached shell still loaded. The same run's staging verification failed,
which skipped the production deploy that would have taken the domain back.
Two lessons stand: an environment that shares a configuration file with
production is one forgotten override away from production, and a
pre-production stage that production depends on in the same pipeline run can
jam every deploy.

## Decision

There are exactly two release channels. They are the same build, deployed
to two Workers, told apart at runtime by one variable.

**Preview.** Worker `interactive-circuit-maker-preview`, configured in its
own file `wrangler.preview.jsonc`, served only at
`analog-canvas-preview.tokenzhang.com`. Nothing in that file inherits from
`wrangler.jsonc`; the workers.dev and version-preview hostnames are off, so
the preview has one address. The preview has no access gate and no login: it
is public but declares `noindex` on every response and answers `/robots.txt`
with `Disallow: /`, and the editor shows a permanent preview banner. Every
merge to `main` deploys the preview automatically, then verifies it: the
shell must reference a script that answers as JavaScript, a missing hashed
asset must answer 404, `/api/channel` must say `preview`, the gallery must
read, a gallery write must be refused, and the simulation route must answer.

**Production.** Worker `interactive-circuit-maker`, `wrangler.jsonc`,
`analog-canvas.tokenzhang.com`. It deploys only from a release: a `v*` tag,
or a manual dispatch naming a commit. Either way the commit must have a
green preview deploy behind it. The existing rollback and re-verification
stay.

**Data.** The preview binds no Durable Object of the production script.
Gallery reads are fetched from the public site's own API over HTTP, with no
cookie, so the preview sees exactly what an anonymous visitor sees and can
do nothing an anonymous visitor cannot: that is read-only by construction,
not by a rule in the very code being previewed. Publishing, liking,
moderation, and Cloud Project saves are refused on the preview with
`preview-read-only` before any handler runs. Accounts, sessions, agent
sessions, analytics, and the preview's own (empty) gallery store are its own
namespaces; no login provider is configured there, so the preview has no
sign-in. Session cookies are host-only, so a visitor to the preview never
carries a production session either. What the preview cannot show is a
change inside a Durable Object class; that ships through production with
its own tests and migration.

**Simulation.** The ngspice container is bound on the preview and not yet on
production. The preview is where the simulation feature lands and is tried;
production gains the binding when the owner promotes a release that carries
it.

**Features.** A feature that must not show on the public site yet is
merged to `main` behind the channel: the editor reads `/api/channel` once
at boot and the Worker exposes `ICM_CHANNEL`. Long-lived feature branches are
not the mechanism; `main` stays releasable.

**Retirement.** Once the preview is verified live and production has moved
to release-only deploys, `env.staging` and `worker/staging-gate.ts` are
deleted. Until then "merge to `main` deploys production" still holds.

## Alternatives considered

### Workers Versions with preview URLs

- Benefits: one Worker, no second environment to drift, instant promotion
  and rollback between versions.
- Costs: a preview version shares production's bindings and data, so a
  write-path defect in an unreleased build reaches the real gallery; preview
  URLs are extra public hostnames.
- Reason not selected: the preview exists precisely to run unverified code,
  and it must not be able to write real data.

### `env.staging` in the production configuration file

- Benefits: one file.
- Costs: every inheritable key is a hazard that only human memory guards.
- Reason not selected: it took the public site down on 2026-09-03.

### A Durable Object binding to the production gallery (`script_name`)

- Benefits: one live store, no proxy hop, every gallery view identical.
- Costs: a binding has no read-only mode; unreleased code would hold write
  capability over real submissions, and the same mechanism would have
  handed it the accounts and sessions store.
- Reason not selected: the preview exists to run unaccepted code, so its
  reach into real data must be bounded by construction, not by a check in
  that code.

### An access-gated staging (Cloudflare Access or a Worker gate)

- Benefits: unreleased work stays private.
- Costs: a gate outside the request path fails open when it is absent or
  misconfigured; a gate inside the Worker has to cover every path and needs
  its own verification, which is what jammed the pipeline.
- Reason not selected: the owner chose an open preview at a distinct
  address; `noindex` and the banner are the mitigations.

## Consequences

### Positive

- Nothing reaches the public site without having been deployed and
  verified somewhere first.
- A broken preview cannot block a production release, and a production
  release cannot be made by accident: it needs a tag or a named commit.
- Big features and simulation can sit on the preview for as long as the
  owner wants, on the real gallery data, without any risk of writing it.

### Negative or limiting

- Two Workers to pay for, including container time on the preview.
- A hotfix to production goes through a tag like any release; when `main`
  carries unreleased work, that work ships dark behind the channel flag.
- Durable Object changes cannot be previewed; the preview's gallery view is
  the public API's view, one HTTP hop away.
- The preview is public. Anyone with the address sees unreleased work.

## Compatibility and migration

- Adds `wrangler.preview.jsonc`, `.github/workflows/deploy-preview.yml`,
  `worker/channel.ts` (channel, read-through, refusals),
  `worker/ngspice-container.ts`, and the editor's
  channel banner. Production configuration and workflow are unchanged in the
  first step.
- The second step changes the production trigger to releases and removes
  `env.staging`, the staging job, and `worker/staging-gate.ts`, with
  `docs/deployment.md` and `AGENTS.md` updated to say that merging to
  `main` deploys the preview.
- No Project file, API, or fixture changes. `/api/channel` is a new
  read-only endpoint that production answers with `production`.

## Validation

- `worker/channel.test.ts` and `worker/preview-config.test.ts` pin the
  channel rules and the preview configuration.
- `scripts/preview-workflow.test.mjs` pins the preview workflow: its own
  configuration file, pinned model archives, and the verification it runs.
- The deploy itself is the evidence: a preview deploy that fails its
  verification is red and names the failing check.

## Related documents

- [ADR 0055](0055-simulation-is-part-of-the-product.md)
- [docs/deployment.md](../deployment.md)
- [simulation spec](../specs/simulation.md)
