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
path group that selects it.

## Validation timing

- Edit loop: focused unit/browser checks and typecheck at the confirmed seam.
- Before affected, build or release gates: run the target-base preflight and
  refresh the plan from the real diff.
- At the end of each original `implement` invocation (each ticket separately),
  before its code-review and commit, run once:

  ```powershell
  pnpm test:local
  pnpm test:e2e:local
  ```

  This repository reads the original's "full suite" as all Vitest and
  Playwright tests. Local browser runs use one worker; pass `--workers` for more.

- An unchanged candidate needs no repeated run; a repair or rebase that changes
  behavior needs its affected checks again.
- Docs and mechanical maintenance outside `implement` use their deterministic
  checks; tooling and gate changes are validated by actual risk.
- Bases: `HEAD` before committing, `HEAD^` after one target commit, else the
  commit before the target began. Test-Impact checks run after committing.
- Before publishing a PR, refresh the mainline base, regenerate the plan for
  the combined diff against `origin/main` and follow
  [delivery](../deployment.md#development-and-delivery-cadence).

## Gallery census

`pnpm gallery:census` runs every drawing of the newest private Gallery snapshot
through loading, netlisting, copying and rotation
(`apps/editor/census/gallery.census.ts`); `--base <ref>` lists drawings that
behave differently on the base. It reads user drawings, so it runs only
locally; reports stay in `plan/`.

Run it before acceptance or delivery for changes to the paths
`scripts/lib/verify-pr-selection.mjs` selects (copying and placement, instance
labels, netlist extraction and printing, Gallery import, Agent copy);
`pnpm verify:pr` prints the command. It cannot certify VACASK compilation,
source assertions or result parsing: simulation changes need their own
source/engine regressions and any named original case.

Snapshot: `node scripts/gallery-private-snapshot.mjs --cached`; for an
operator-provided one, `node scripts/gallery-private-snapshot.mjs --local <dir>`
then `pnpm gallery:census -- --backup <dir>/gallery.sqlite`. Unavailable
private data is a recorded, explicitly accepted delivery limitation, never a
census pass.

The census rejects new drawing failures, netlist text changes, labels that stop
following parts and changed Gallery marks while `NETLIST_MARK_RULE_VERSION` is
unchanged. Fix each finding or explain the accepted change in the commit. A
real-data defect also gets a small synthetic regression.

## Pull-request checks

The merge queue runs two required checks once on the PR merged with current
`main`: `Core contracts` (static, full unit/module suite, build, goldens,
smoke, packaging, performance budgets) and `Browser tests` (specs mapped to
changed product paths). On the PR itself CI only plans scope and checks
Test-Impact trailers. Only `pnpm test:e2e`, run locally, covers every browser
spec. Core accepts only successful planning, build preparation and all three
parallel check branches; failed, cancelled or unexpected skipped prerequisites
fail it. Pull requests and successfully planned documentation-only changes
keep their existing skips.

Queue formatting checks use the merged candidate's changed files within the
normal formatting scope. Formatter configuration, ignore rules or lockfile
changes, or an untrusted base/configuration, require the full formatting check.
All other static contracts still run in full. Shared package output must match
the candidate, platform, toolchain, source inputs and file digests; local
standalone tests continue to build their own dependencies.

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
