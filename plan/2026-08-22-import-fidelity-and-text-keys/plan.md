---
status: completed
experience: none
---

# Imports keep their Power Rails, and Enter finishes text

## Goal

Stop losing a Power Rail when a circuit is inserted from the gallery, keep a
Port's label beside the symbol through every rotation, and make Enter finish
text everywhere.

## The import defect

Reported: inserting a circuit from the gallery lost its VDD line. Traced by
probing the copy itself rather than the UI.

`copySelection` is driven by the instances a user picked, so
`deriveInternalGroupSelection` keeps only Nets whose every terminal is inside
that selection — and it requires at least one terminal. A Net with **no**
instance terminals, such as a Power Rail drawn but not yet wired to a device,
therefore never qualified, and its rail routes, junctions, and label were
dropped.

Bundled examples hid this: their rails are wired to transistors, so the Net
had terminals and survived. A published circuit whose rail is not yet wired
did not.

`copyWholeDocument` is the honest primitive for importing a circuit —
everything drawn belongs — and `beginProjectImportPlacement` now uses it.

## Work

1. Add `copyWholeDocument` and import through it.
2. Constrain a Port's label to a horizontal side: upright text above or below
   a rotated Port reads as the label having flipped over. It now swaps between
   left and right and never sits above or below.
3. Enter finishes text in every canvas editor; Shift+Enter starts a line.
4. Drop the gallery column slider: columns follow the panel's dragged width,
   the same way the Library tiles do.

## Measured, not changed

- A rectangle label is already centred: its text box centre and the
  rectangle's centre both measure 400 in the same probe.
- Schematic and drafting text already share one family
  (`"DejaVu Sans", Arial, …`) at one size. The visual difference is weight and
  slope, which is the intended split: box text upright, device and Port names
  italic, subscripts upright.

## Validation

- Full unit suite (1189 passed), full Playwright suite (208 passed)
- New clipboard case proves the defect and the fix: a rail with no device on
  it is absent from `copySelection` and present in `copyWholeDocument`
- `tsc -p tsconfig.check.json`, Prettier, `git diff --check`

## Gate Review

- Decision: affected
- Early gates: typecheck, Prettier
- Affected gates: clipboard and derived unit tests, the manual-editor and
  component-insert Playwright specs
- Final gates: remote GitHub Actions
- Platform risks: none

## Test Impact

- Decision: tests-updated
- Contracts: what an import carries, where a Port label sits, and what Enter
  does in a canvas text editor.
- Primary checks: `apps/editor/src/features/clipboard/clipboard.test.ts`,
  `apps/editor/e2e/manual-editor.spec.ts`

## Commit Intent

```text
fix(editor): keep Power Rails when importing a circuit
```

## Outcome

An imported circuit arrives whole, a Port label never sits above or below its
symbol, and Enter finishes text with Shift+Enter starting a line.
