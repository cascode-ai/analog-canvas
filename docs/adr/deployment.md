# Deployment Channels and Release Routing

Status: `accepted`

Owners: `.github/workflows`, `scripts/release-route.mjs`, `worker`

## Decision

Use separately configured Preview and Production channels, with the PR's
`preview` label selecting the merge route. [Deployment](../deployment.md)
owns exact entrances, candidate handling, verification and recovery; it is the
single release-policy reference.

## Context

Unreleased work needs an acceptance surface that cannot write Production data.
Small changes also need a deliberate direct-release route without forcing a
second manual promotion for every merge.

## Rationale

Separate complete configurations make storage and credential boundaries
explicit; inherited overrides or shared Production bindings would rely on
remembering every exception. Preview Gallery read-through provides realistic
public examples without private storage authority. Public visibility and
`noindex` are not authentication.

A visible label expresses the chosen route independently of the merger's
identity or guessed risk from changed paths. The accepted cost is that an
unlabeled merge skips Preview acceptance; required checks and Production
verification/rollback protect that route. A failed route lookup must fail
closed rather than guess.

One candidate build prevents promotion from accepting one artifact and serving
another. Requiring promoted commits on main prevents debug PR heads from
becoming Production releases. Channel bindings stay outside the candidate;
Preview data is not promoted with code, and reverting a Worker cannot roll
back a storage migration.
