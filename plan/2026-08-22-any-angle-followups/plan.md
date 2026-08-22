---
status: completed
experience: none
---

# Any-angle follow-ups and dead code from the corner cycle

## Goal

Finish what ADR 0039 started: a free-angle Route must behave like any other
Route, and the two-way routing toggle it replaced should not linger.

## Work

1. `transaction-route-follow` skipped any Route that was not octilinear, so a
   free-angle Route silently stopped following the instance it was drawn from
   when that instance moved. It now skips only geometry that would be
   degenerate.
2. Remove `toggle-wire-routing-mode`. The corner cycle names the mode it wants
   because a two-way toggle cannot reach the third shape, which left the
   action reachable from nothing.

## Validation

- Full unit suite (1191 passed), full Playwright suite (211 passed)
- `tsc -p tsconfig.check.json`, Prettier, `git diff --check`

## Gate Review

- Decision: affected
- Early gates: typecheck, Prettier
- Affected gates: edit-engine wire-path and interaction-state unit tests
- Final gates: remote GitHub Actions
- Platform risks: none

## Test Impact

- Decision: tests-updated
- Contracts: that a free-angle Route follows its instance, and how the wire
  routing mode is set.
- Primary checks: `packages/edit-engine/src/wire-path.test.ts`,
  `apps/editor/src/interaction/interaction-state.test.ts`

## Commit Intent

```text
fix(edit-engine): let a free-angle Route follow its instance
```

## Outcome

A free-angle Route follows a moved instance, and the superseded routing toggle
is gone.
