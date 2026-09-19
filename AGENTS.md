# Agent Working Rules

Treat the repository as an engineering project: bounded targets, explicit
ownership, risk-proportional validation, and decisions recorded where the work
is. What a change did and why is stated in its commit message, which travels
with the diff through `git log`, `git blame`, and the pull request.

Notes you keep while working — scratch plans, checklists, drafts — belong in
the untracked `plan/` directory. They are a local working area and are not
published.

## Three-Stage Development and Delivery

The cadence is local iteration, a delivered pull request, and, for work routed
to Preview, a deliberate promotion. A request to change the editor starts in
the local stage unless the user explicitly requests a later stage.

1. **Local iteration.** Continue the current local batch branch, or create
   `codex/local-batch` from current `main` when starting a new batch. Use
   `pnpm dev` for feedback and focused checks for each bounded target. Keep
   separate, explanatory local commits for separate targets. A completed local
   target ends with its commit and validation; it does not automatically open a
   PR, push, merge, deploy, or bump the product version. Push a branch for backup
   when requested without treating that backup as a delivery.
2. **Delivery.** When the user asks to deliver, open one pull request for the
   completed change or batch, run the mainline delivery gate, wait for the
   required PR checks, merge, and verify the deployed channel. The pull
   request's `preview` label chooses that channel (Deployment rationale): without it, the
   merge deploys directly to Production; with it, every push deploys the pull
   request to Preview and the merge deploys to Preview only. Label large or
   risky changes, work a collaborator debugs on Preview, and anything someone
   should click through first; ask when the choice is unclear. Batching is
   optional. A change means one independently useful feature, fix, or
   improvement; supporting tests, repair commits, files, and formatting do not
   count as extra changes. Prepare any intended release version before merging.
3. **Promotion.** Promote a Preview-accepted commit on `main` when the user
   requests Production publication or has already authorized that release.
   Passing Preview is not itself a Production trigger. Use the existing
   version-tag or explicit-dispatch route, and finish deployed verification.
   Do not ask again for authorization already given.

Keep a short working list in `plan/local-batch.md` while a batch is in
progress: the branch, completed changes and count, validation still needed,
and current stage. Read it when continuing the batch and reconcile it with
local commit messages; commit count alone is not a change count. Start the next
list after the batch is delivered. Decisions and validation that must survive
delivery belong in the commits and pull request. A squash merge's description
must preserve the target summary, test impact, validation, and unresolved
limitations.

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
- For local iteration, plan and validate the current target's delta rather than
  repeatedly treating the accumulated batch as a new change. Start with focused
  unit/browser checks directly. Run
  `pnpm gate:preflight -- --base <target-base>` before executing selected
  affected, build, or release gates, and use
  `pnpm gate:affected -- --base <target-base>` for the bounded gates the target
  needs. The Test-Impact check reads commit messages, so check its declaration
  after committing. A planned `full-delivery` gate is owed at batch promotion;
  it is not an instruction to rerun full delivery after each local edit. Run
  broader local checks earlier when the target's actual risk requires them.
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
- **Production incident exception.** While production is broken, restoring
  service outranks the delivery route: pushing straight to `main` is allowed,
  and so is any shortcut that shortens the outage. This is written down
  because the alternative is worse — a rule that forbids it is a rule people
  break while panicking, and a broken rule protects nothing. Two conditions
  make it a route rather than a hole: it applies only while service is
  actually degraded, not to a change someone is merely in a hurry about; and
  once service is back, the bypass gets a written record — what was broken,
  what was pushed, and which checks were skipped — in the follow-up commit or
  PR. The record is the point. A bypass nobody wrote down is indistinguishable
  from a bypass nobody noticed.
- Gate planning selects validation obligations. Shared-core changes, gate-policy
  changes, and unclassified non-documentation paths require the full fallback
  when delivering the batch; bounded changes use selected focused checks.
  Batching never authorizes skipping a required GitHub check.
- Report unresolved questions in the commit message or a review note; do not
  leave them only in an untracked working note.

## Circuit Asset Rules

- For accepted Symbol geometry or pin-position changes, historical drawing
  layouts and routes may be left for manual repair. Do not audit or repair
  every old design as a prerequisite to completing the current change, or
  add a general migration/compatibility layer just to preserve old layouts.
  A small one-off repair script is appropriate when concrete affected cases
  can be fixed by a few clear, deterministic rules with little effort;
  otherwise leave them for a human. Record known impacts with the change.
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

Before considering a local target complete:

1. Run the validation the target's risk calls for. A full suite is required
   only when justified by breadth, risk, or project policy.
2. At minimum, run `git diff --check` and `git status --short --branch`.
3. Review the diff, stage only intended files, and commit locally on the batch
   branch. Update the batch working list. Push and merge belong to the Preview
   stage; a local target can be complete while its batch awaits publication.
4. Write the commit message so it stands alone: what changed, why, the
   validation that backs it, and the `Test-Impact:` trailer. State anything a
   reader would otherwise have to reconstruct — a defect's root cause, a
   contract that moved, or work deliberately left out.
5. Do not automatically extract a reusable lesson. When a human asks, draft a
   candidate under `docs/experience/` with supporting evidence for the human
   to accept, edit, or reject.

## Mainline Delivery Gate

Focused validation is the normal local development loop. Run this delivery
gate when the accumulated batch is ready for Preview, using the entire batch
relative to its mainline base. Delivery keeps full unit, release, and performance
protection for the implementation batch while the browser layer is selected by
impact.

Merging a pull request labeled `preview` deploys only the **preview** channel;
merging any other pull request deploys directly to the public site. A
promotion deploys only from a `v*` release tag, or a manual dispatch of an
accepted ref, whose commit is on `main` and already has a green preview
deploy; see Deployment rationale and `docs/deployment.md`.

Before a non-document change is merged or pushed to `main`:

1. Start from a clean dependency state with
   `pnpm install --frozen-lockfile`. Run `pnpm setup:e2e` once on a machine that
   does not yet have the matching Playwright Chromium installation.
2. Run `pnpm gate:preflight -- --base <base-ref>`.
3. Run `pnpm gate:affected -- --base <base-ref>` when the plan selects bounded
   affected gates. When it selects `full-delivery`, run the target's focused
   checks locally and let the required PR checks own the single broad core run
   plus the mapped browser contracts. Do not run the same full suite both
   locally and remotely just because publication is next. Run `pnpm gate:full`
   locally when actual risk cannot be represented by the browser map, when it
   calls for pre-push full evidence, or when remote CI is unavailable.
4. Push a review branch and wait for both GitHub required checks.
   `Core contracts` runs static contracts, the complete unit/module suite, and
   the release/performance checks on one shared runner. `Browser tests` runs
   only the mapped affected specs, or a small insertion/runtime fallback for
   an unmapped product path. The branch must still be based on current `main`;
   if `main` changes while checks run, update once and revalidate. Current
   branches merge directly after this one CI pass. Weekly scheduled and manual
   CI runs retain the complete four-shard browser audit; the scheduled audit
   does not repeat Core contracts for a commit that already passed them.
5. If a remote check fails, keep the target active: inspect its log, repair the
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
- Do not add or run unnecessary content-hash checks. SHA256 verification is
  prohibited unless a concrete security or integrity requirement makes it
  essential; ordinary build provenance, deployment and functional acceptance
  must not grow repeated payload hashing steps.
- Do not delete review notes or open questions to make the repository appear
  clean. Unresolved work is reported, not tidied away.
