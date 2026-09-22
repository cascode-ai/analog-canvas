# Test System

Tests protect current behavior, explicit rejection boundaries, and safety
invariants. They are not a line-coverage contest and must not silently turn an
implementation detail into a public contract.

The [contract matrix](contract-matrix.md) identifies the primary owner for each
cross-cutting behavior. Co-locate a low-cost unit or module-contract test with
its implementation; keep browser workflows under `apps/editor/e2e/`; keep
release, generated-artifact, and visual checks in their existing scripts.

## Layers

| Layer                 | Purpose                                                          | Typical location                            |
| --------------------- | ---------------------------------------------------------------- | ------------------------------------------- |
| Static and generated  | types, formatting, documentation links, generated-output drift   | root scripts and `ci:static`                |
| Unit                  | pure algorithms, value boundaries, deterministic transformations | adjacent `*.test.ts`                        |
| Module contract       | one package's public input/output, including rejection cases     | package test beside the public boundary     |
| Cross-module contract | one fact interpreted consistently across package boundaries      | owning boundary package, named for the fact |
| Browser workflow      | a user-visible flow that cannot be proved below the browser      | `apps/editor/e2e/`                          |
| Release and golden    | built product, artifacts, visual reference, packaging            | root scripts and release checks             |

Use the cheapest layer that can prove the behavior. Keep one primary contract
test per behavior; add a higher-layer test only when it proves wiring or a real
user path that the lower layer cannot prove.

## Advisory gate planning

Before expensive validation, inspect the real commands selected for the
change:

```powershell
pnpm gate:plan -- --path packages/model/src/schema/document.ts
pnpm gate:plan -- --base <base-ref>
pnpm gate:preflight -- --base <base-ref>
pnpm gate:affected -- --base <base-ref>
```

Use the current target's base for local checks and the mainline base for batch
delivery, as described below.

The versioned catalog at `config/validation-gates.json` maps repository paths
to preflight, affected, and final gates. Shared-core, production-boundary,
unknown non-documentation, and gate-policy changes select the conservative
branch/full fallback for local planning. The PR planner separately translates
shipped product paths into focused browser contracts. Unit tests, package
manifests, the Node-only local host and Node platform package stay in Core
contracts instead of allocating a browser. An unmapped browser path gets a
small insertion/runtime-safety fallback alongside all mapped contracts; an
unmapped path never removes another changed path's selected tests. The complete browser suite remains a
weekly scheduled and manual audit.

`gate:preflight` runs cheap static contracts and cross-checks the commit's test
impact declaration. `gate:affected` runs the catalog's bounded unit, focused
browser, release, or branch checks. Review the printed reasons before
execution. When the plan selects `full-delivery`, that complete gate
supersedes static, unit, focused-browser, release, and branch verification:
at batch delivery, run `gate:preflight` for the independent Test-Impact
declaration, skip the empty affected stage, and run `gate:full` once. Run
`pnpm setup:e2e` once per machine or Playwright version instead of paying for a
browser installation on every full check.

Every `apps/editor/e2e/*.spec.ts` file must belong to a focused path group and
select itself. The gate-planner tests enumerate the directory so adding a spec
without routing ownership fails deterministically instead of silently relying
on the generic browser fallback.

The editor's browser workflows have separate owners: `manual-editor.spec.ts`
retains general integration, `wiring-semantics.spec.ts` owns wire interaction,
`component-property-workflows.spec.ts`
owns live property/model/display edits, and `netlist-workflows.spec.ts` owns
import, authoring and export. Shared app/canvas dependencies select all three;
wire-tool changes select their dedicated contract without selecting unrelated
general, property and netlist UI workflows. Their small shared fixture module
still selects every consumer. The full component catalog is checked by
`component-property-catalog.test.ts`; browser catalog checks cover representative
capabilities and the VDD exception rather than repeating the same UI for every
symbol. Keep specialized history, rejection, hierarchy and terminal tests.

PR browser contracts use two balanced Playwright shards, or four when the
affected selection contains at least twelve spec files, with three workers
per runner. A lightweight `Browser tests` aggregation job preserves the required
check name and succeeds only after all selected shards pass. This keeps broad but
legitimate focused selections within the PR wall-clock budget without raising
per-runner Chromium contention; weekly scheduled and manual audits retain their
separate four-shard full-suite route.

## Local iteration and batch validation

Day-to-day changes accumulate on a local batch branch. Use the development
server and the smallest checks that prove each target's behavior and direct
dependencies, then commit it locally. Do not start a full delivery run, PR, or
deployment merely because one small target is complete.

Keep validation scope distinct from publication scope. Before a local commit,
`pnpm gate:plan -- --base HEAD` describes its uncommitted delta. After one
target commit, `HEAD^` is its base; for a target spanning several commits, use
the base before that target began. Test-Impact validation reads committed
trailers and therefore runs after the target commit. Direct focused unit/browser
checks belong to the edit loop; apply the selected preflight before executing
affected, build, or release gates. A target needing broad validation should get
it, but a `full-delivery` entry records a batch delivery
obligation rather than requiring full delivery after each local edit.

A delivered pull request may carry one change or a batch. Before publishing it,
refresh the mainline base, regenerate the gate plan for the combined diff
against `origin/main`, and follow the
[mainline delivery gate](../../AGENTS.md#mainline-delivery-gate). This checks
interactions and shared contracts across everything the pull request carries.
An unchanged candidate does not need its already-passing local checks repeated
while remote CI runs; new edits or unresolved failures can require fresh
verification.

This changes when delivery validation runs, not the required GitHub checks.
The [deployment guide](../deployment.md#development-and-publication-cadence)
owns the local-to-Production handoff and rollback.

## Batch pull-request checks

Every implementation pull request keeps two required checks:

- `Core contracts` shares one checkout and dependency install while running
  all static and generated checks, the complete unit/module suite, the build,
  release goldens, production smoke, packaging, and
  `performance-baseline.mjs` budgets.
- `Browser tests` runs the specs mapped to the changed shipped-product paths
  with three workers. An unmapped browser-product path runs the small component
  insertion and runtime-crash fallback. A non-browser implementation change
  skips this required job successfully without allocating a runner. GitHub's
  runner Chrome avoids downloading a separate browser image. `ci:e2e` first
  compiles only the editor's workspace dependencies whose `dist/` the Vite
  configuration and the Node-side specs load; Vite serves the editor sources
  directly because the Core job already owns the production build.

Weekly scheduled and manual workflows run the complete browser suite in four
shards. The scheduled audit skips Core contracts because the audited `main`
commit already passed them in its pull request; manual full validation retains
both layers.
A PR based on current `main` merges after its two required checks without
repeating them in a merge queue. CI does not repeat on the subsequent `main`
push; the Production workflow builds, deploys, and verifies the merged commit.
A release tag or explicit dispatch may redeploy another selected commit only
when that commit is already on `main`.
[Deployment](../deployment.md) owns that sequence and recovery.

## Change discipline

Every commit that changes implementation code must carry one test-impact
trailer:

```text
Test-Impact: tests-updated
```

For behavior-neutral work, use `no-test-change` and state the evidence on the
same line:

```text
Test-Impact: no-test-change — formatting-only change; no emitted code or behavior changed
```

`pnpm test:impact -- --base <base-ref>` checks the changed range. It accepts a
test update with `tests-updated`, or a testless implementation change with an
explicit evidence-based `no-test-change` decision. It deliberately does not
force meaningless test-file edits. The trailer lives with the diff in Git; a
local untracked plan may still be used as scratch work, but it is not a gate
input.

## Removing or simplifying a test

A test is not dead merely because it mentions a retired shape. Keep rejection,
migration, authorization, and input-hardening tests while their boundary is
reachable. Remove or merge a test only when all are true:

1. Its protected production surface is unreachable or is covered by a named
   primary contract at the same or stronger boundary.
2. Deletion does not remove the only rejection, compatibility, history, or
   safety assertion for the behavior.
3. The target plan records the replacement protection or why none is needed.

Split an oversized suite by protected behavior, not by arbitrary line count.
Prefer small shared fixture builders over copying an entire Project when only a
few facts are relevant.

## Coverage

Coverage is diagnostic evidence, not a merge threshold. Use it to find an
unexercised critical boundary, then add a behavior-level test. Do not retain
large, brittle tests solely to preserve a percentage.
