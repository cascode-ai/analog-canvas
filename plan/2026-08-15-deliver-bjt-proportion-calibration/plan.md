---
status: completed
experience: none
---

# Deliver the Razavi BJT proportion calibration

## Goal

Rebase the reviewed BJT proportion calibration onto current `origin/main`, run
the required clean mainline gate, submit it for remote required checks, and
merge it into `main` only after those checks pass.

## State and Ownership

Start state from `git status --short --branch`:

```text
## codex/calibrate-bjt-proportions...origin/codex/calibrate-bjt-proportions
```

The worktree is clean. This delivery target owns its delivery record and may
rewrite/push the already-owned review branch. It will not alter the BJT asset
content unless a rebase conflict requires an explicitly documented repair.
The first clean gate found a TypeScript-only narrowing error in the BJT/MOS
ratio regression added by the calibration target; this delivery target also
owns the minimal test-only narrowing repair needed to satisfy the required
gate.

- `plan/2026-08-15-deliver-bjt-proportion-calibration/plan.md`
- `plan/log.md`
- `packages/symbols/src/razavi-catalog.test.ts` for the gate-required
  test-only narrowing repair

Read-only shared dependencies are `origin/main`, GitHub required checks, and
the already-validated BJT asset commit `34a2bb9`.

## Work

1. Rebase the review branch onto current `origin/main` and resolve only any
   direct delivery conflict.
2. Correct the BJT/MOS regression test's static narrowing without changing its
   assertion or production geometry.
3. From a clean dependency/build state, run `pnpm install --frozen-lockfile`
   followed by `pnpm ci:check`.
4. Create or update the review PR, wait for required GitHub Actions checks,
   and merge only if all are green.

## Validation

- `pnpm install --frozen-lockfile`
- `pnpm ci:check`
- all required remote PR checks green on the final pushed commit
- `git diff --check`
- `git status --short --branch`

## Commit Intent

Commit the delivery record as:

```text
docs(plan): record BJT calibration delivery
```

## Outcome

Rebased the calibration commit onto `origin/main` at `f25833f`; the sole
conflict was `plan/log.md`, resolved by preserving the newer mainline entries
and retaining the BJT record. The full clean gate passed after the minimal
test-only narrowing repair: 754 unit tests, 129 browser tests, workspace
build, release checks, and production smoke. PR #78 then passed all five
required remote CI checks. This delivery record is the only subsequent change;
it does not alter BJT assets or production code.
