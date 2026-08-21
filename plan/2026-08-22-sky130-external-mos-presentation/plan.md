---
status: completed
experience: none
---

# SKY130 External MOS Presentation

## Goal

Make reviewed four-terminal SKY130 NFET/PFET external-subcircuit calls use the
existing Razavi NMOS/PMOS artwork, and let a user select those masters through
the existing MOS Model field without changing the `I` / Insert Component flow
or the emitted `X` invocation.

## State and Ownership

Start state from `git status --short --branch` in the independent worktree:

```text
## codex/sky130-external-mos-presentation
```

The worktree is clean and was created from `main` at `e64afa16`. Untracked
dependency/worktree infrastructure and unrelated plan directories in the root
checkout are outside this worktree and will remain untouched.

- `packages/symbols/src/hierarchical-block.ts`
- `packages/symbols/src/hierarchical-block.test.ts`
- `packages/symbols/src/pdk-registry.ts`
- `packages/symbols/src/pdk-registry.test.ts`
- `packages/edit-engine/src/hierarchy-planner.ts`
- focused edit-engine tests required by the binding transition
- `apps/editor/src/app/App.tsx`
- `apps/editor/src/features/component-insert/component-parameters.ts`
- `apps/editor/src/features/properties/additional-parameters.ts`
- `apps/editor/src/features/properties/use-properties-editor.ts`
- focused editor unit/E2E tests for Model authoring and import presentation
- `packages/spice/src/compiler.test.ts`
- `docs/user/spice-compatibility.md`
- this plan and `plan/log.md`

- Read-only: existing Razavi `nmos`/`pmos` assets and device descriptors.
- Shared: ADR 0029 external-definition identity and `X` binding; D/G/S/B Net
  membership; Project-level structural transactions; deterministic netlist
  export.

## Work

1. Derive a reviewed SKY130 external symbol from existing NMOS/PMOS artwork
   while retaining the external definition's stable Symbol ID and explicit
   four-terminal interface; preserve generic block fallback.
2. Add a bounded Project planner that creates/reuses the reviewed SKY130
   external definition and atomically changes a compatible selected MOS
   between ordinary model binding and SKY130 external binding without losing
   Nets, Routes, NoConnects, raw parameters, or schematic naming.
3. Keep the existing Model input and `I` flow, add SKY130 suggestions/status,
   and expose `nf` for the mapped external instance without inventing model
   files, defaults, or parameter conversion.
4. Protect import, manual authoring, save/reopen, visual fallback, and `X`
   export behavior with focused contracts and document the structural-only
   boundary.

## Validation

- Focused symbol, edit-engine, importer/editor unit tests changed by the work.
- Focused hierarchy and SKY130 manual-editor browser scenarios.
- `pnpm gate:plan -- --base origin/main`
- `pnpm gate:preflight -- --base origin/main`
- `pnpm gate:affected -- --base origin/main`
- `pnpm test:impact -- --base origin/main`
- `git diff --check`
- `git status --short --branch`
- `pnpm install --frozen-lockfile` and `pnpm ci:check` before mainline delivery.

Electrical simulation is out of scope: this target preserves reviewed
structural invocation and connectivity but supplies no foundry model files,
corner, simulator, analysis, or electrical acceptance claim.

## Gate Review

- Decision: affected
- The advisory plan classified all expected files and did not require the full
  fallback during development.
- Early gates: gate-review check, static contracts, and test-impact.
- Affected gates: workspace unit tests plus hierarchy and editor browser
  contracts.
- Final gates: complete `pnpm ci:check` and required GitHub checks before any
  non-document mainline delivery.
- Platform risks: browser Properties/placement interaction is the primary
  platform surface; no generated Razavi asset, release-only package, binary,
  or golden change is planned.

## Test Impact

- Decision: tests-updated
- Contracts: reviewed SKY130 name/count/pin matching, external stable Symbol
  identity with MOS artwork, atomic M/X binding transition, unchanged
  connectivity/raw parameters, generic fallback, and structural `X` export.
- Primary checks: focused symbol/edit-engine/editor unit tests and SKY130
  browser import/manual-selection regression coverage.

## Commit Intent

Commit as:

```text
feat(schematic): present SKY130 external MOS devices
```

## Outcome

Reviewed four-terminal SKY130 NFET/PFET external definitions now retain their
external stable identity and `X` semantics while borrowing the existing
Razavi MOS artwork with an explicit bulk pin. The unchanged MOS Model field
offers one reviewed target per polarity and atomically creates/reuses the
external definition, preserves connectivity/schematic naming/raw parameters,
renumbers `M` to `X`, and exposes `nf`; switching back to an ordinary model is
also atomic and leaves the reusable definition intact. Unknown, mismatched, or
explicitly presented external definitions remain generic blocks.

Validation passed: focused contracts (32 tests plus registry/planner reruns),
the affected gate (167 files / 1018 unit tests and all selected browser suites),
frozen install, and canonical `pnpm ci:check` including builds, release checks,
production smoke, and 171 browser tests. No simulation or electrical claim was
made.
