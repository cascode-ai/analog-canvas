# ADR 0058: Label-routed releases

Status: accepted

Date: 2026-09-17

Owners: `.github/workflows`, `.github/actions/build-deployment-candidate`,
`scripts/release-route.mjs`

## Context

[ADR 0057](0057-release-channels-preview-and-production.md) deploys every
merge to Preview and treats Production as a separate release step. In
practice Preview became a mandatory stop rather than an observation window:
on 2026-09-16 thirteen Preview deploys led to six Production releases, most of
them started within a minute of their Preview run. Small fixes paid for a
second manual step, while a collaborator needed a place to debug work before
and after merging without shipping it. The owner also wants the route to be an
explicit, visible property of the change, not inferred from who merged it.

## Decision

The `preview` label on a pull request chooses the channel.

- **Labeled merge:** a merged pull request carrying `preview` deploys only to
  Preview. Promotion is unchanged from ADR 0057: a `v*` tag or a manual
  dispatch deploys the candidate that Preview accepted, without rebuilding.
- **Unlabeled merge:** every other merge to main deploys directly to
  Production. The Production workflow builds that merge commit once, with the
  same build action Preview uses, deploys exactly those bytes, and runs the
  existing live verification, simulation smoke and automatic rollback.
  Preview is not touched, so it keeps showing labeled work.
- **Open pull request:** while a same-repository pull request carries
  `preview`, each push deploys its head to Preview for debugging. Such a
  candidate can never reach Production: every promotion requires the commit to
  be on main.
- **No pull request:** a direct push to main, as allowed by the production
  incident exception in AGENTS.md, deploys to Production.
- **Routing input:** only the label, read from the GitHub API by
  `scripts/release-route.mjs`. Neither the merger's identity nor the changed
  paths choose the channel. A lookup that keeps failing fails the run instead
  of guessing.

Everything else in ADR 0057 stays: two complete Wrangler configurations,
Preview's own accounts and Projects, its Gallery read-through, its private
acceptance identity, the Preview-only VACASK engine, and path-selected
acceptance depth on Preview. Documentation-only merges still deploy nothing.

## Alternatives considered

### Route by who merged

- Benefits: no action needed from the author.
- Costs: the route is invisible on the pull request and changes with whoever
  presses merge.
- Reason not selected: the owner asked for an explicit marker.

### Route high-risk paths to Preview automatically

- Benefits: Simulation, Agent and deployment changes would get hosted
  acceptance even when the label is forgotten.
- Costs: a second rule to explain, and surprises when an ordinary fix touches
  one of those paths.
- Reason not selected: the owner chose the label as the only switch.

### Keep every merge on Preview, then approve Production

- Benefits: every change passes hosted acceptance first.
- Costs: two steps for every small fix, and Preview is overwritten by every
  merge.
- Reason not selected: it keeps the friction this ADR removes.

## Consequences

### Positive

- A small fix ships in one merge.
- Preview keeps the labeled work a collaborator is debugging.
- Both channels build candidates through one action definition.
- Unmerged code cannot be promoted.

### Negative or limiting

- An unlabeled merge skips Preview's hosted acceptance (real simulator host,
  published MCP and GUI journeys). Only the pull request's required checks,
  the Production verification and the automatic rollback protect it.
- Forgetting the label ships the change directly.
- Routing depends on the GitHub API. Both workflows read the label
  independently, so a failed lookup shows as a red run to re-run.
- Every pull request shows a skipped Preview run unless it is labeled.

## Compatibility and migration

Tags and manual dispatches keep working and now also require the commit to be
on main. Preview candidates are named by the deployed commit, which is a pull
request's head for labeled pull requests. The `preview` label must exist in
the repository. [Deployment](../deployment.md), AGENTS.md, README.md and
CLAUDE.md describe the routes.

## Validation

`scripts/lib/release-route.test.mjs` covers labels, unmerged and multiple pull
requests, direct pushes and lookup failures. `scripts/deploy-workflow.test.mjs`
and `scripts/preview-workflow.test.mjs` protect the entrances, the on-main
check, the shared build action and the unchanged verification and rollback.
The change that introduced this ADR was itself labeled `preview`: its head was
deployed to Preview before merge, its merge routed to Preview, and its
promotion exercised the on-main check. The next unlabeled merge exercises the
direct Production route.

## Related documents

- [ADR 0057: Release channels](0057-release-channels-preview-and-production.md)
- [Deployment](../deployment.md)
- [Working rules](../../AGENTS.md)
