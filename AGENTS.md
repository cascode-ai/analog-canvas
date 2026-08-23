# Agent Working Rules

Treat the repository as an engineering project: bounded targets, explicit
ownership, risk-proportional validation, and decisions recorded where the work
is. What a change did and why is stated in its commit message, which travels
with the diff through `git log`, `git blame`, and the pull request.

Notes you keep while working — scratch plans, checklists, drafts — belong in
the untracked `plan/` directory. They are a local working area and are not
published.

## Operating Discipline

Before starting a target:

1. Run `git status --short --branch` from the repository root.
2. Audit dirty state by ownership:
   - Proceed normally when the worktree is clean.
   - When it is dirty, identify whether each changed path belongs to the
     current target, the user, another worker, or an earlier target.
   - Unrelated dirty paths do not automatically block work.
   - Stop before editing when dirty paths overlap the target's owned files,
     ownership is unclear, or a dirty shared contract affects the target.
   - Say so in the commit message when proceeding with unrelated dirty files
     present.
3. Identify the target owner, goal, expected files, shared dependencies, and
   validation surface.
4. Read `README.md` and any closer domain instructions.
5. Review validation intent before editing:
   - Run `pnpm gate:plan -- --path <expected-path>` for the expected owned
     paths when practical.
   - Expand the selected commands and identify platform, release, generated-
     artifact, and golden-state assumptions.
   - State which gates you chose, and why, in the commit message.

## Before Editing

Know the boundary of the target before editing tracked files: the goal, which
paths it owns, what the dirty state means for it, and which shared contracts
it touches. Hold that in a local note if it helps; the repository does not
require a file for it.

Do not edit outside the target's boundary without deciding, deliberately, that
the boundary has moved.

## During Work

- Keep each target small and reviewable; exclude unrelated cleanup.
- Define a target by one ownership and validation boundary, not by every
  visible symptom. Closely related micro-fixes that share files, contracts,
  and validation belong in one target; independent changes do not.
- Protect shared contracts, generated artifacts, binary assets, and user-owned
  work unless the target explicitly claims them.
- Decide deliberately before expanding scope or taking on a new dependency, and
  say so in the commit.
- Regenerate the advisory gate plan from the real diff with
  `pnpm gate:plan -- --base <base-ref>` before expensive validation. If the
  actual selection differs materially from the gates you chose, revisit the
  choice before proceeding.
- Run `pnpm gate:preflight -- --base <base-ref>` before affected browser,
  build, release, or complete gates. Use
  `pnpm gate:affected -- --base <base-ref>` as the normal automated development
  validation after focused implementation checks.
- Prefer the smallest deterministic validation that covers changed behavior,
  direct dependencies, and credible failure risks.
- Add tests when behavior changes, a regression needs protection, or a
  contract is best demonstrated automatically. Do not add tests that merely
  restate an implementation.
- Declare test impact in the commit that changes implementation code, using a
  trailer:

  ```text
  Test-Impact: tests-updated
  Test-Impact: no-test-change — <evidence behavior is unchanged or protected>
  ```

  `pnpm test:impact -- --base <base-ref>` cross-checks the claim against the
  diff: `tests-updated` requires a changed test file, and `no-test-change`
  requires that none changed plus its evidence. CI runs the same check. See
  `docs/testing/README.md` and its contract matrix.
- Keep one primary test layer per behavior. A test mentioning retired input is
  not automatically dead: retain reachable rejection, migration, history, and
  safety boundaries until their replacement is explicit.
- Do not run a full suite by default. Expand from focused checks when the
  change crosses shared contracts or subsystems, carries broader risk, or a
  project gate requires it.
- Use `pnpm test:local <test-paths>` for affected unit contracts and
  `pnpm test:e2e:local <spec-paths> [--grep <pattern>]` for affected
  browser behavior. Both commands cap local concurrency.
- Use `pnpm verify:branch` when a completed branch crosses enough workspace
  boundaries to justify static checks, all unit tests, one build, and the
  production smoke check. It is not the mainline delivery gate.
- Gate planning is advisory in this phase. It does not authorize skipping the
  canonical mainline gate or any required GitHub check. Gate-policy changes and
  unclassified non-documentation paths require the full fallback.
- Report unresolved questions in the commit message or a review note; do not
  leave them only in an untracked working note.

## Circuit Asset Rules

- Keep each circuit fixture in its own `netlists/<circuit-name>/` directory.
- Preserve explicit `.subckt` interfaces and instance pin order. Interface
  changes are shared-contract changes and require checking every caller.
- Keep local model files beside the netlist that includes them unless a target
  intentionally introduces a shared model library.
- Do not claim electrical correctness from syntax inspection alone. If the
  target changes electrical behavior, name the simulator, models, analyses,
  corners, and acceptance criteria used—or record why simulation is blocked.
- Never silently replace foundry or vendor model data with illustrative
  values. Label topology-only fixtures and simplified models clearly.

## After Work

Before considering a target complete:

1. Run the validation the target's risk calls for. A full suite is required
   only when justified by breadth, risk, or project policy.
2. At minimum, run `git diff --check` and `git status --short --branch`.
3. Review the diff, stage only intended files, then commit and push according
   to branch policy.
4. Write the commit message so it stands alone: what changed, why, the
   validation that backs it, and the `Test-Impact:` trailer. State anything a
   reader would otherwise have to reconstruct — a defect's root cause, a
   contract that moved, or work deliberately left out.
5. Do not automatically extract a reusable lesson. When a human asks, draft a
   candidate under `docs/experience/` with supporting evidence for the human
   to accept, edit, or reject.

## Mainline Delivery Gate

Focused validation is the normal development loop. It is not sufficient by
itself to deliver a non-document change to `main`.

Before a non-document change is merged or pushed to `main`:

1. Start the canonical CI check from a clean dependency/build state:
   `pnpm install --frozen-lockfile` followed by `pnpm ci:check`.
2. Push a review branch and wait for the corresponding GitHub Actions required
   checks to finish successfully.
3. If a remote check fails, keep the target active: inspect its log, repair the
   reported cause, and repeat verification. A successful `git push` is not a
   completed delivery.

Do not bypass the gate by weakening, skipping, or deleting a failing check.
When a test or golden is obsolete, demonstrate that the accepted behavior is
preserved and update the contract deliberately. If the check cannot run in the
local environment, record the limitation and require the remote green result.

## Where the Record Lives

The automatic per-target loop is:

```text
bounded target -> implementation -> validation -> commit that explains itself
```

The cross-target experience layer is human-triggered:

```text
human reviews commits, failures, or review notes
-> human requests extraction
-> Agent drafts an evidence-backed candidate lesson
-> human accepts, edits, or rejects it
```

Git owns the record. A commit message owns the intent, the reasoning, the
validation, and the test-impact declaration for exactly the change it carries,
so the two can never drift apart. An experience note under `docs/experience/`
owns only a transferable judgment supported by evidence, and a human decides
whether something is a lesson.

Working notes under `plan/` are untracked. They are yours while a target is in
flight; anything that matters afterwards belongs in the commit.

## Boundary and Hygiene Rules

- Do not mix unrelated targets in one commit.
- Do not mix reusable workflow changes with project artifacts unless the commit
  explains why they must land together.
- Do not use model confidence as the only quality gate when deterministic
  validation or human review is available.
- Do not delete review notes or open questions to make the repository appear
  clean. Unresolved work is reported, not tidied away.
