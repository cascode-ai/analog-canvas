---
status: completed
experience: none
---

# Permit local named VDD Port Nets in netlist export

## Goal

Align design-netlist validation with the accepted named-power policy: a VDD
Port connected to an explicitly named `powerDomain: vdd` Net may be local or
global and emits no device record, while Ground continues to require the
explicit global node `0`.

## State and Ownership

Start state from `git status --short --branch`:

```text
## codex/sky130-canonical-mos-mapping...origin/codex/sky130-canonical-mos-mapping
```

The dedicated worktree is clean after the completed SKY130 canonical-MOS
commit. This is a separate export-contract correction found during localhost
acceptance testing.

- `packages/netlist/src/extract.ts`
- `packages/netlist/src/current-contract.test.ts`
- `docs/specs/netlist-export.md`
- this target plan and `plan/log.md`

Shared dependencies are ADR 0036's local named VDD policy, the `vdd-port` and
`ground` device descriptors, and the persisted `Net.name`, `scope`, and
`powerDomain` facts. Editor authoring and model schemas are read-only.

## Work

1. Separate Ground validation from VDD Port validation instead of imposing the
   Ground global-Net rule on every net marker.
2. Require VDD Port to reference an explicitly named VDD-domain Net, without
   restricting that Net to global scope.
3. Add direct export tests for legal local VDD, legal Ground, and invalid VDD
   classification while retaining non-emitting marker behavior.
4. Correct the deterministic netlist specification to match current VDD Port
   authoring semantics.

## Validation

- `pnpm test:local packages/netlist/src/current-contract.test.ts`
- `pnpm gate:preflight -- --base 3be59366`
- `pnpm gate:affected -- --base 3be59366`
- `pnpm test:impact -- --base 3be59366`
- `git diff --check`
- `git status --short --branch`

## Gate Review

- Decision: affected
- Early gates: gate-review, static contracts, and test-impact
- Affected gates: workspace unit tests selected by the netlist extractor and
  its current-contract suite
- Final gates: `pnpm ci:check` remains required before mainline delivery
- Platform risks: none beyond shared SPICE/Spectre extraction behavior; no
  generated or browser artifact changes

The advisory path plan selected workspace unit coverage and no full fallback.
The base is the preceding completed SKY130 commit so this stacked target's
validation selection is isolated from the already-validated first target.

## Test Impact

- Decision: tests-updated
- Contracts: local named VDD Port Nets export without a marker instance;
  Ground remains global node `0`; a VDD Port cannot bless a non-VDD Net
- Primary checks: `packages/netlist/src/current-contract.test.ts`

## Commit Intent

Commit as:

```text
fix(netlist): allow local named VDD ports
```

## Outcome

Separated shared net-marker validation from marker-specific electrical rules.
VDD Port now accepts an explicitly named local or global VDD-domain Net and
remains non-emitting; Ground still requires the explicit global Net `0`.
Focused coverage passed 17/17, and the affected workspace unit sweep passed
1173/1173 after static, type, documentation, and test-impact preflight checks.
