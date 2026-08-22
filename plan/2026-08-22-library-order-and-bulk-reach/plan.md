---
status: completed
experience: none
---

# Library category order and Bulk action reach

## Goal

Put the two most-reached-for controls where the hand already is: order the
Library categories by placement frequency, and lead the MOS Bulk section with
its draw action instead of burying it under the default-Net selects.

## State and Ownership

Start state from `git status --short --branch`:

```text
## claude/library-order-and-bulk
```

Branched from `origin/main` after PR #174 merged. `.claude/` and
`node_modules` are untracked local scaffolding for this pnpm-less machine.

- `apps/editor/src/features/component-insert/symbol-catalog.ts`
- `apps/editor/src/features/component-insert/symbol-catalog.test.ts`
- `apps/editor/src/app/App.tsx`
- `apps/editor/src/styles.css`
- `apps/editor/e2e/manual-editor.spec.ts`

- Shared: the Library category taxonomy, which the Insert dialog and the
  Library panel both render.

## Work

1. Reorder `CATEGORY_ORDER` to Transistors, Passives, Power and Ports,
   Sources, Switches, Analog Blocks, Logic Gates. Category membership is
   unchanged — only the display order moves.
2. Move the MOS bulk `<section>` to the head of the selection panel so it is
   not reached past the Placement Tray.
3. Promote "Draw bulk connection" to the first control in that section and
   accent it, leaving the two default-Net selects below as settings.

## Validation

- `git diff --check`
- `git status --short --branch`
- `vitest run apps/editor/src/features/component-insert` (47 passed)
- Playwright `component-insert.spec.ts` + `manual-editor.spec.ts` (117 passed)
- Verified in a running editor: the Library renders Transistors → Passives →
  Power and Ports, and the Properties panel opens on Bulk with the accented
  action directly under the heading.

## Gate Review

- Decision: affected
- Early gates: `tsc -p tsconfig.check.json`, Prettier on changed files
- Affected gates: the component-insert unit tests plus the two Playwright
  specs that cover the Library panel and the selection panel
- Final gates: remote GitHub Actions on the PR
- Platform risks: none; presentation-only, no model or generated artifact
  touched

## Test Impact

- Decision: tests-updated
- Contracts: Library category display order; the Bulk section's position and
  control order.
- Primary checks:
  `apps/editor/src/features/component-insert/symbol-catalog.test.ts`,
  `apps/editor/e2e/manual-editor.spec.ts`

Both are new assertions rather than edits to existing ones: no test asserted
category order before, so the previous order could drift silently.

## Commit Intent

Commit as:

```text
feat(editor): order the Library by reach and lead Bulk with its action
```

## Outcome

Category membership and every electrical behavior are unchanged; only display
order and control order moved. Two new assertions now pin both, since neither
was covered before.
