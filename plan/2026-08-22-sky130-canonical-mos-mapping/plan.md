---
status: completed
experience: none
---

# Reuse canonical MOS symbols for reviewed SKY130 external calls

## Goal

Map reviewed SKY130 four-node external calls onto the existing canonical
`nmos`/`pmos` symbols, while retaining their external-subcircuit binding,
ordered D/G/S/B connectivity, X reference, master name, parameters, and
round-trip netlist behavior. Confirm that the existing explicit-B auxiliary
anchor and imported routing-guidance path supplies the expected Bulk flightline
without changing the MOS electrical protocol.

## State and Ownership

Start state from `git status --short --branch`:

```text
## codex/sky130-canonical-mos-mapping
```

The dedicated worktree is clean. Root-level untracked `.worktrees/` and
`.pnpm-store/` belong to workspace infrastructure and are outside this
worktree and target.

- `packages/spice/src/importer.ts`
- `packages/spice/src/compiler.test.ts`
- `packages/edit-engine/src/hierarchy-planner.ts`
- `packages/edit-engine/src/hierarchy-planner.test.ts`
- `packages/edit-engine/src/project-transaction.ts`
- `packages/edit-engine/src/project-transaction.test.ts`
- `packages/symbols/src/pdk-registry.ts`
- `packages/symbols/src/pdk-registry.test.ts`
- `packages/symbols/src/hierarchical-block.ts`
- `packages/symbols/src/hierarchical-block.test.ts`
- `packages/derived/src/routing-guidance.test.ts`
- `packages/netlist/src/current-contract.test.ts`
- `apps/editor/src/app/App.tsx`
- `apps/editor/e2e/manual-editor.spec.ts`
- this target plan and `plan/log.md`

Shared dependencies are the accepted external-definition binding contract,
canonical MOS D/G/S/B symbol/device contracts, and derived Bulk visibility and
routing guidance. The model schema, device descriptors, MOS symbol assets,
generated artifacts, and netlist extractor are read-only for this target.

## Work

1. Preserve the reviewed PDK mapping's canonical MOS `symbolId` through both
   SPICE import passes while keeping the external definition binding.
2. Keep canonical `nmos`/`pmos` symbols when switching Model targets and when
   upserting compatible external definitions; retain generic external symbols
   for unknown or incompatible definitions.
3. Keep the existing Insert workflow but use canonical MOS artwork and
   placement for reviewed external masters; retain the generic external path
   for other definitions.
4. Remove the special four-terminal SKY130 artwork expectation and prove the
   canonical three-terminal presentation, explicit B endpoint guidance, and
   external X-call export contract with focused tests.

## Validation

- `pnpm test:local packages/spice/src/compiler.test.ts packages/edit-engine/src/hierarchy-planner.test.ts packages/edit-engine/src/project-transaction.test.ts packages/symbols/src/pdk-registry.test.ts packages/symbols/src/hierarchical-block.test.ts packages/derived/src/routing-guidance.test.ts packages/netlist/src/current-contract.test.ts`
- `pnpm gate:preflight -- --base origin/main`
- `pnpm gate:affected -- --base origin/main`
- `pnpm test:impact -- --base origin/main`
- `git diff --check`
- `git status --short --branch`

## Gate Review

- Decision: affected
- Early gates: `gate-review`, `ci:static`, and `test:impact`
- Affected gates: workspace unit tests and hierarchy browser coverage
- Final gates: `pnpm ci:check` before any mainline delivery; this branch target
  will first complete focused and affected validation
- Platform risks: external-definition changes cross importer, editor planning,
  symbol resolution, and hierarchy browser behavior; no generated or release
  artifact is intentionally changed

The advisory path plan selected workspace unit tests plus
`apps/editor/e2e/hierarchy.spec.ts`; no full fallback was required.

## Test Impact

- Decision: tests-updated
- Contracts: reviewed SKY130 X calls reuse canonical MOS presentation and
  explicit Bulk guidance while preserving D/G/S/B external netlist order
- Primary checks: `packages/spice/src/compiler.test.ts`,
  `packages/edit-engine/src/hierarchy-planner.test.ts`,
  `packages/edit-engine/src/project-transaction.test.ts`, and
  `packages/derived/src/routing-guidance.test.ts`, with direct external export
  protection in `packages/netlist/src/current-contract.test.ts` and the
  existing Model-field browser workflow in `apps/editor/e2e/manual-editor.spec.ts`

## Commit Intent

Commit as:

```text
fix(schematic): reuse canonical MOS for SKY130 calls
```

## Outcome

Reviewed SKY130 external calls now keep canonical `nmos`/`pmos` symbols across
SPICE import, the existing Model field, compatible definition updates, and the
unchanged Insert workflow. Their external definition, X reference, raw
parameters, and ordered D/G/S/B node contract remain authoritative for export.
Unknown, incompatible, or explicitly presented external definitions retain the
generic external-symbol path. The pre-existing auxiliary B endpoint and
imported routing-guidance implementation required no production change; a new
test demonstrates that explicit imported B membership produces its flightline.

Validation passed: focused tests (64), preflight static/type/test-impact gates,
affected workspace units (183 files / 1171 tests), hierarchy Playwright (12),
manual-editor Playwright (93), the focused SKY130 Model-field browser case,
workspace build, production preview smoke, `pnpm verify:branch`, and
`git diff --check`. The first affected run reached the browser suites before a
clean worktree build had created package `dist` files; building the workspace
resolved that environment prerequisite, and the complete affected rerun passed.
