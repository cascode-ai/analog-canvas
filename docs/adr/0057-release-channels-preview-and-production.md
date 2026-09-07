# ADR 0057: Release channels — Preview and Production

Status: accepted

Date: 2026-09-04

Owners: `worker`, `.github/workflows`, `apps/editor`

## Context

Deploying every merge directly to the public site gives unreleased features no
acceptance surface. A staging environment inheriting Production configuration
also risks taking over its routes or gaining write authority over real data.

## Decision

Use two separately configured Workers from the same source tree, not inherited
Wrangler environments and not a claim of one promoted binary artifact.

- **Preview:** `wrangler.preview.jsonc`, its own hostname and namespaces.
  Every merge to main deploys and verifies this channel. The public shell is
  unindexed and visibly labelled. Public Gallery reads go through Production's
  anonymous HTTP API and Gallery writes are refused. When a Preview-only Google
  OAuth client is configured, human testers sign in and save private Projects
  in Preview's own namespace; CI uses a separate acceptance identity against
  that same Project API. Preview has no binding to Production's Durable Objects.
- **Production:** `wrangler.jsonc`. A release tag or explicit commit dispatch
  selects the candidate. The workflow checks for a successful Preview deployment
  of that exact commit before deploying, verifying, and recovering on failure.
- **Runtime state:** `/api/channel` and `ICM_CHANNEL` identify the channel.
  They do not authorize private data or simulator execution. Preview simulation
  has its own owner/admission state and configured executor.
- **Execution:** hosted simulation uses the operator-managed container behind
  the configured gateway/Tunnel. It is not a Worker-native process or a spare
  Cloudflare Container. An unavailable named executor does not silently fall back.
- **Data and identity:** cookies and credentials remain host/session scoped.
  Preview accounts, sessions, and Projects are independent from Production and
  its test data is not promoted or synchronized. Preview's production-Gallery
  view cannot validate private Production storage migrations; those require
  their own tests and release care.

The exact deployment commands, evidence predicate, capabilities, and recovery
limitations are owned by [deployment](../deployment.md). This ADR does not add a
second release gate or promise that Production serves every Preview capability.

## Alternatives and consequences

A Worker version sharing Production bindings cannot provide read-only isolation
by construction. An inherited staging configuration depends on remembering every
override. Both were rejected in favor of a separate public Preview.

The cost is another deployment with its own configuration and runtime resources.
Public Preview reveals unreleased work; `noindex` is not authentication.
Production remains deliberate, while a previously qualified commit can be
released independently of later development on main. Emergencies follow the
explicit incident exception in [working rules](../../AGENTS.md).

## Validation

Channel/configuration tests protect namespace and route separation. Preview
verification must exercise the deployed asset and simulation paths, not just
unit-test configuration objects. Production verification and rollback each
measure the actual serving site. Data migrations are not undone by reverting
a Worker version.

## Related documents

- [Simulation decision](0055-simulation-is-part-of-the-product.md)
- [Deployment](../deployment.md)
- [Simulation execution](../specs/simulation-execution.md)
