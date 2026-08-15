---
status: completed
experience: none
---

# Calibrate Razavi BJT proportions against the reviewed MOS scale

## Goal

Reduce only the visible NPN/PNP BJT body proportions so their base bars and
diagonal branches match the user-reviewed textbook BJT-to-MOS ratio. Preserve
electrical C/B/E anchors, pin directions, stroke roles, and the established
NPN/PNP arrow topology.

## State and Ownership

Start state from `git status --short --branch`:

```text
## HEAD (no branch)
```

The detached delivery worktree was clean before this target; it is now owned by
`codex/calibrate-bjt-proportions`. This target owns:

- `fixtures/visual-reference/razavi-reference-v1/npn-vector-source.json`
- `fixtures/visual-reference/razavi-reference-v1/pnp-vector-source.json`
- `fixtures/visual-reference/razavi-reference-v1/manifest.json`
- regenerated `packages/symbols/assets/razavi-v1/{npn,pnp}.symbol.json`
- regenerated `packages/symbols/assets/razavi-v1/catalog.json` and
  `packages/symbols/src/razavi-catalog.generated.ts`
- `packages/symbols/src/razavi-catalog.test.ts` for the calibrated geometry
  contract
- this plan and the corresponding factual `plan/log.md` entry.

Read-only inputs are the existing MOS assets and geometry measurement, the
source-PDF witnesses, and the user-provided textbook screenshot used to derive
the BJT/MOS relative ratios. The generator and visual-authority loader are
shared dependencies and will not be changed. During generation, the clean
baseline revealed that the manifest's pinned SHA-256 for the untouched
`inductor-vector-source.json` and `opamp-vector-source.json` are stale
(`ee09…`/`e894…` recorded vs `daaf…`/`43f1…` actual in `HEAD`). Repairing only
those existing manifest pins is necessary to validate or generate any Razavi
asset and is included as a bounded ancillary fix.

## Work

1. Apply the measured body and branch scale correction to both BJT source
   normalizations, while retaining every pin anchor, stroke role, and arrow
   orientation/topology.
2. Update authority hashes, regenerate the common-symbol assets and generated
   catalog, then confirm the source contracts remain valid.
3. Repair the unrelated stale inductor and op-amp source hashes in the same
   authority manifest; do not alter their evidence or geometry.
4. Recompute the BJT/MOS proportion checks and run focused authority/catalog
   tests.

## Validation

- `pnpm symbols:razavi-common`
- `pnpm symbols:razavi`
- `pnpm symbols:razavi-common:check`
- `pnpm symbols:razavi:check`
- focused Razavi catalog and authority tests
- coordinate check: BJT base/MOS gate-bar and BJT branch/base ratios
- `git diff --check`
- `git status --short --branch`

## Commit Intent

Commit as:

```text
fix(symbols): calibrate Razavi BJT proportions
```

## Outcome

Calibrated both BJT bodies from the user-reviewed textbook/MOS coordinate
ratios without moving C/B/E anchors, changing stroke roles, or changing the
NPN/PNP arrow topology. The new generated assets measure base/MOS long-gate
bar `1.067006` (target `1.069767`), branch/base horizontal `0.632382` (target
`0.630435`), and branch/base vertical `0.261529` (target `0.260870`). The PNP
arrow now uses the exact transformed NPN triangle template, preserving the
mirror relationship. Repaired two pre-existing, stale manifest SHA pins for
the untouched inductor and op-amp vector evidence so the protected Razavi
generation/validation chain can run again.

Validation passed: common-symbol and full Razavi catalog generation plus stale
checks; 24 focused authority/catalog tests; Symbols TypeScript build; editor
production build; coordinate assertions; and `git diff --check`.
