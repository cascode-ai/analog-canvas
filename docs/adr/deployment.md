# Production-Only Hosted Delivery

Status: `accepted`
Owners: `.github/workflows`, `worker`, `containers/canvas-cn`

Production is the only hosted channel; every merged non-documentation change
deploys its exact `main` commit with mandatory verification and rollback
([procedure](../deployment.md)). Preview had drifted and added a workflow,
promotion and credentials without evidence beyond PR checks plus Production
verification. Its Worker stays as route-free storage because deleting it could
make Durable Object data unrecoverable.

The China region runs Production's release, not a second build or channel
([China region](../deployment.md#china-region)). Its host pulls each commit
after Production has served it, and `wrangler.jsonc` stays the only binding
declaration; the region lists only its differences, which CI checks. A
hand-kept second configuration, editor build and simulator stack had drifted
within days (missing scheduled work, SG13G2 and rate limits), and others'
changes routinely missed the region. Pulling keeps the region's only outbound
dependency the Production origin, because GitHub downloads from the region
are too slow to use.
