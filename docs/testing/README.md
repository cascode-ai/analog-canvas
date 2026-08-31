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
pnpm gate:plan -- --base origin/main
pnpm gate:preflight -- --base origin/main
pnpm gate:affected -- --base origin/main
```

The versioned catalog at `config/validation-gates.json` maps repository paths
to preflight, affected, and final gates. Shared-core, production-boundary,
unknown non-documentation, and gate-policy changes select the conservative
branch/full fallback. Bounded changes select focused browser contracts; this
does not skip any required GitHub check because all four browser check names
remain present and run the selected specs.

`gate:preflight` runs cheap static contracts and cross-checks the commit's test
impact declaration. `gate:affected` runs the catalog's bounded unit, focused
browser, release, or branch checks. Review the printed reasons before
execution. When the plan selects `full-delivery`, that complete gate
supersedes static, unit, focused-browser, release, and branch verification:
run `gate:preflight` for the independent Test-Impact declaration, skip the
empty affected stage, and run `gate:full` once. Run `pnpm setup:e2e` once per
machine or Playwright version instead of paying for a browser installation on
every full check.

Every `apps/editor/e2e/*.spec.ts` file must belong to a focused path group and
select itself. The gate-planner tests enumerate the directory so adding a spec
without routing ownership fails deterministically instead of silently making
that path fall back to the complete browser suite.

## Pull-request batching

Every implementation pull request keeps the inexpensive broad protection:

- `Static contracts` runs all static and generated checks.
- `Unit and integration tests` runs the complete unit/module suite.
- `Release contracts` runs the build, release goldens, production smoke, and
  `performance-baseline.mjs` budgets.
- `Browser tests (1/4)` through `Browser tests (4/4)` run the fixed affected
  specs with two workers per shard. If the path map is missing, high risk, or
  itself changed, all four checks automatically run the complete browser
  suite.

The merge queue, nightly schedule, and manual workflow always force complete
browser coverage. CI does not repeat on the subsequent `main` push; the
Cloudflare workflow builds, deploys, and smoke-checks the production URL after
the required pull-request checks have already passed.

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
