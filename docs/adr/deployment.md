# Production-Only Hosted Delivery

Status: `accepted`

Owners: `.github/workflows`, `worker`

## Decision

Use Production as the only hosted application channel. Every merged
non-documentation change builds and deploys its exact `main` commit after the
required PR checks. Production verification and rollback remain mandatory.
[Deployment](../deployment.md) owns exact entrances, candidate handling,
verification and recovery; it is the single release-policy reference.

The hosted Preview channel was retired on 2026-09-20. Its custom domain and
execution entrances are removed, while its Worker, Durable Object namespaces,
R2 bucket, queues, accounts, and Projects remain dormant for possible recovery.

## Context

Preview had drifted behind Production and no longer provided a reliable
acceptance boundary. Maintaining route selection, a second deployment workflow,
candidate promotion, credentials, and hosted journeys made ordinary releases
slower without supplying evidence that the required PR checks and Production
verification did not already provide.

## Rationale

One hosted channel makes the release route unambiguous and removes duplicate
candidate handling. Requiring every tag or manual release commit to already be
on `main` prevents unreviewed branch heads from becoming Production releases.
The Production candidate is built once and the exact verified bytes are
deployed. Runtime bindings stay outside the candidate, and reverting a Worker
still cannot roll back a storage migration.

Deleting the Preview Worker would make data recovery uncertain or impossible,
especially for Durable Objects. A route-free Worker therefore remains as the
storage authority. Its configuration deliberately has no assets, public URL,
custom domain, cron, or queue consumer. Retirement verifies that the Worker,
R2 bucket, and queue resources continue to exist.
