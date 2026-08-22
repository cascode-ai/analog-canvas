---
status: completed
experience: none
---

# MOS geometry: total width, fingers, and usable defaults

## Goal

Make W mean total width with a finger count beside it, guarantee
`W = FW × NF`, show the parallel multiplier, and let a placed device display a
value without every field being typed first.

## Owner decision

"W should be the total width, finger width is per finger, and W = FW × NF must
hold." Finger width is therefore derived, never stored: a second stored value
could drift out of agreement with W.

## State and Ownership

Branched from `origin/main` as `claude/port-behavior`.

- `packages/devices/src/contract.ts`, `descriptors/{nmos,pmos}.ts`
- `packages/derived/src/instance-value.ts`
- `apps/editor/src/features/component-insert/component-parameters.ts`
- `apps/editor/src/features/properties/finger-width.ts` (new)
- `apps/editor/src/app/App.tsx`, `styles.css`
- tests for the above

## Work

1. Add `defaultValue` to the parameter contract and seed it at placement. A
   MOS with no geometry could not display a value at all, so its Value toggle
   stayed disabled until every field was typed. Defaults are written into the
   typed netlist like any authored value — the schematic and the exported
   netlist must never disagree.
2. Add `nf` as an ordinary MOS parameter (`finger-count`, default 1). This
   also removes a duplicate: `externalMosComponentParameters` used to append a
   synthetic NF, which would now have produced two.
3. Derive finger width in the editor as `W / NF` and show it read-only beside
   the parameters, stating the identity it came from.
4. Show the parallel multiplier in the MOS value when it is not 1; it changes
   the device the drawing stands for.

Finger width is derived in `apps/editor` rather than `@icm/derived` because
the SPICE number parser lives in `@icm/spice`, which sits above `derived` in
the package layering.

## Validation

- Full unit suite (1193 passed), full Playwright suite (209 passed)
- `node scripts/visual-golden.mjs --check` clean
- `tsc -p tsconfig.check.json`, Prettier, `git diff --check`

## Gate Review

- Decision: full
- Early gates: typecheck, Prettier
- Affected gates: devices, symbols parity, derived value projection, editor
  parameter tests, the two MOS Playwright specs
- Final gates: golden check, remote GitHub Actions
- Platform risks: seeding defaults changes what a placed MOS exports, so the
  netlist and visual goldens were checked rather than assumed.

## Test Impact

- Decision: tests-updated
- Contracts: the MOS parameter set, placement defaults, and the value
  projection.
- Primary checks: `packages/devices/src/registry.test.ts`,
  `packages/symbols/src/device-parity.test.ts`,
  `apps/editor/src/features/properties/finger-width.test.ts`,
  `apps/editor/e2e/{component-insert,manual-editor}.spec.ts`

Two Playwright cases asserted that the Value toggle stays disabled until W and
L are typed. That was the reported defect, so both now assert the opposite.

## Commit Intent

```text
feat(devices): total MOS width with derived finger width and usable defaults
```

## Outcome

W is the total width, NF divides it into fingers, FW is shown as `W / NF`, the
multiplier appears in the value when it matters, and a placed MOS can show its
value immediately.
