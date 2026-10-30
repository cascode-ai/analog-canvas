# Test System

Tests protect current behavior, rejection boundaries and safety invariants.
The [contract matrix](contract-matrix.md) names each behavior's primary test.

## Layers

| Layer                 | Purpose                                                          | Typical location                            |
| --------------------- | ---------------------------------------------------------------- | ------------------------------------------- |
| Static and generated  | types, formatting, documentation links, generated-output drift   | root scripts and `ci:static`                |
| Unit                  | pure algorithms, value boundaries, deterministic transformations | adjacent `*.test.ts`                        |
| Module contract       | one package's public input/output, including rejection cases     | package test beside the public boundary     |
| Cross-module contract | one fact interpreted consistently across package boundaries      | owning boundary package, named for the fact |
| Browser workflow      | a user-visible flow that cannot be proved below the browser      | `apps/editor/e2e/`                          |
| Release and golden    | built product, artifacts, visual reference, packaging            | root scripts and release checks             |

Use the cheapest layer that proves the behavior, one primary contract test per
behavior; add a higher-layer test only for wiring or a real user path the lower
layer cannot prove.

Agent client and MCP tests talk to the real editor via `liveAgentEditor()`
(`apps/editor/src/agent/live-agent-editor.test-support.ts`); script only relay
faults and the network services the editor calls, never the editor's answers.

## Gate planning

```powershell
pnpm gate:plan -- --path <file>
pnpm gate:plan -- --base <base-ref>
pnpm gate:preflight -- --base <base-ref>
pnpm gate:affected -- --base <base-ref>
```

`config/validation-gates.json` maps paths to gates; review the printed reasons
before running. `full-delivery` is a batch delivery obligation, not a command
after every edit: record in the PR how final local, risk and queue checks fulfil it, and
skip `gate:full` when they already cover it. Run `pnpm setup:e2e` once per
machine or Playwright version. A new `apps/editor/e2e/*.spec.ts` needs a focused
path group or a named `manualChecks` entry in the catalog. Environment-gated
specs must not appear in ordinary gate commands or CI browser arguments.
Adjacent compatible browser gates execute as one deduplicated batch; other
commands retain their execution order.
Use the plan to identify remaining work after a PR check; rerunning an entire
stage is unnecessary when its checks already have valid evidence.

## Validation timing

- Edit loop: focused unit/browser checks and typecheck at the confirmed seam.
- Before affected, build or release gates: run the target-base preflight and
  refresh the plan from the real diff.
- Before review and commit, run the local PR checks and fulfil the affected
  build/browser/environment obligations from the final diff. Local unit checks
  trace ordinary source changes; shared-core, deleted source, configuration and
  unclassified inputs require the full unit suite. Built Web/offline boundaries
  are explicit obligations: import tracing alone cannot qualify them.
- Run full local unit and browser suites once for shared-core, validation
  infrastructure or uncertain impact (the plan's high-risk/full-fallback routes).
  Ordinary changes need their affected checks, not a full suite per ticket.
  The queue still qualifies its merged candidate with full ordinary units and
  mapped browser tests.
- Reuse evidence only for the same candidate, inputs, configuration and environment.
  List completed checks and outstanding obligations in the PR; run only the
  remainder. A repair or rebase invalidates affected evidence; uncertain impact
  invalidates the full result. No persistent local pass cache substitutes for this.
- Conditional skips do not qualify environment-dependent behavior. Complete the
  affected named [environment checks](#environment-dependent-execution); missing
  resources and unrun targets remain explicit gaps.
- Docs and mechanical maintenance outside `implement` use their deterministic
  checks; tooling and gate changes are validated by actual risk.
- Bases: `HEAD` before committing, `HEAD^` after one target commit, else the
  commit before the target began. Test-Impact checks run after committing.
- Before publishing a PR, refresh the mainline base, regenerate the plan for
  the combined diff against `origin/main` and follow
  [delivery](../deployment.md#development-and-delivery-cadence).

## Gallery census

The census reads private drawings and runs locally. Keep snapshots private and
reports and entry-level failures in ignored `plan/`, outside CI and published
artifacts. `pnpm gallery:census -- --help` describes the checks and filters.
The `insert` group runs each entry through the editor's Gallery commands on
independent fresh canvases. Open succeeds after project installation; insert
succeeds after a placement commit or an installed fallback. Reports distinguish
insertion, new-tab fallback, empty-scene opening and failure.

Before accepting changes selected by `scripts/lib/verify-pr-selection.mjs`,
run its selected groups; `pnpm verify:pr` prints the command. For every product
release, also run the full-entry `insert` group against the last successfully
deployed SHA as required by [delivery](../deployment.md#development-and-delivery-cadence).

Use `--base <git-ref>` to measure both refs with the current harness, or
`--compare BASE.json HEAD.json` for saved reports. Both reports must cover the
same complete snapshot, statuses, check groups and insertion target with the
same harness. Partial reports, older formats without the required results,
different snapshots and incomplete entry coverage require both refs to rerun.
A baseline rerun measures the older code with the current harness; it is not
the original release's historical measurement.

Record the snapshot's capture time, content digest, source inventory and public
entry count. Confirm the input covers Community and all public Dataset sources;
an empty anonymous source listing does not establish complete coverage.
Use [Gallery backup](../gallery-backup.md) for authorized input collection.
Missing or incomplete private input is an explicitly accepted delivery
limitation, never a census pass.

The comparison rejects new failures, changed netlists, labels that stop
following parts and changed Gallery marks without a `NETLIST_MARK_RULE_VERSION`
bump. Historical failures remain visible; they are not new regressions. Fix
each new finding or record its accepted explanation and add a small synthetic
regression for a real-data defect. The census does not certify simulation
compilation, source assertions or result parsing; those need engine-specific
checks and any named original case.

## Pull-request checks

The merge queue runs two required checks once on the PR merged with current
`main`: `Core contracts` (static, ordinary unit/module suite, build, goldens,
smoke, packaging, performance budgets) and `Browser tests` (specs mapped to
changed product paths). The primary CI workflow plans PR scope and checks
Test-Impact trailers; the additional environment workflows below also run on
affected PRs. They are separate from the two required queue checks. Core
accepts only successful planning, build preparation and all three parallel
check branches; failed, cancelled or unexpected skipped prerequisites fail it.
The primary workflow's PR and documentation-only skips remain unchanged.

Queue formatting checks use the merged candidate's changed files within the
normal formatting scope. Formatter configuration, ignore rules or lockfile
changes, or an untrusted base/configuration, require the full formatting check.
All other static contracts still run in full. Shared package output must match
the candidate, platform, toolchain, source inputs and file digests; local
standalone tests continue to build their own dependencies.

## Environment-dependent execution

[Ngspice model tests](../../.github/workflows/ngspice-tests.yml) and
[Windows platform tests](../../.github/workflows/platform-tests.yml) qualify
affected PRs and support manual runs. [Simulator host](../../.github/workflows/simulator-host.yml),
action/job `vacask-compat-build`, manually qualifies native execution, pinned
source conversion and the real MCP journey. [Browser performance
evidence](../../.github/workflows/performance.yml), job `measure`, measures a
fresh production build with synthetic fixtures. These checks do not deploy or
replace required merge checks or existing performance budgets.

Prepare the selected lane's resources from the
[environment manifest](../../scripts/lib/environment-test-lanes.mjs).
Workflows own installation and pinned inputs; the
[runner](../../scripts/run-environment-tests.mjs) owns preflight and result
acceptance. Every named target must be present and pass. A file's pure
assertions cannot substitute for skipped environment targets; a different
engine's assertions do not qualify the selected engine. Preserve reports for
the candidate SHA. Missing resources or unrun workflows remain explicit
validation gaps.

## Timing evidence

Browser reports distinguish cumulative attempt cost (including retries), the
slowest single attempt and elapsed time per run. Parallel runs can overlap;
neither summed test cost nor runner queue time is test execution wall time.
CI retains each shard report after failure. A run killed before producing its
report has missing timing evidence, not zero cost. Release checks expose
individual bounded steps; diagnose the failed step before changing timeouts.

## Change discipline

Every commit that changes implementation code carries one trailer:

```text
Test-Impact: tests-updated
Test-Impact: no-test-change — <evidence that behavior did not change>
```

`pnpm test:impact -- --base <base-ref>` checks the range.

## Removing or simplifying a test

Keep rejection, migration, authorization and input-hardening tests while their
boundary is reachable. Remove or merge a test only when all hold:

1. Its production surface is unreachable or covered by a named primary
   contract at the same or stronger boundary.
2. It is not the only rejection, compatibility, history or safety assertion for
   the behavior.
3. The commit names the replacement protection or why none is needed.

A browser test meets condition 1 when a named lower-layer test covers it,
unless the browser is the point (pointer or focus, layout, font metrics,
clipboard, download, cross-tab, or the flow's only GUI wiring test); push any
uncovered assertion down first.

## Unused code and file size

An export only tests use is dead (`pnpm deadcode`, run by `pnpm verify:pr`):
delete it with its tests under the rules above, or tag it `@internal` with the
reason. For a changed product file past 1,000 lines (`verify:pr` warns), the
reviewer decides whether to split it along its seams. Coverage is diagnostic,
never a threshold.

## Circuit/model and fixture validation

Each circuit fixture lives in `netlists/<circuit-name>/` with its local models.
Preserve `.subckt` interfaces, pin order (changes check every caller) and
foundry data; label simplified models and topology-only fixtures.

Electrical behavior changes report simulator, models, analyses, corners and
acceptance criteria, or why simulation is blocked; syntax inspection alone
proves nothing electrical.

Native model-source acceptance (operator-run, after `pnpm build`):
`node scripts/model-source-smoke.mjs <HTTPS executor origin>`; hosted runs need
`SIMULATION_SMOKE_TOKEN`. It proves the source pipeline, not transistor-level
performance.

Symbol geometry/pin changes state their known drawing impacts; repair old
layouts only with a bounded one-off when a few deterministic rules suffice.

For unclear, intermittent, cross-layer or real-data defects use diagnosing-bugs
([development workflow](../development-workflow.md#特殊入口)). Raise
intermittent reproduction rates, measure performance before bisecting, report
attempted methods and missing input when no feedback loop exists, redact
private artifacts and obtain authorization for environment access or
production instrumentation.
