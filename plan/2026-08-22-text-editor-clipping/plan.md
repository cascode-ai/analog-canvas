---
status: completed
experience: none
---

# The canvas text editor stops clipping long labels

## Goal

Make everything typed into the canvas text editor visible. A label longer
than one line was cut off with no way to reach the rest.

## State and Ownership

Start state from `git status --short --branch`:

```text
## claude/text-editor-clipping
```

Branched from `origin/main` after PR #183 merged.

- `apps/editor/src/features/text-editing/canvas-text-editor-overlay.tsx`
- `apps/editor/src/features/text-editing/canvas-text-editor-overlay.test.ts`
- `apps/editor/src/styles.css`
- `apps/editor/e2e/manual-editor.spec.ts`

## The defect

Measured on a Port's right-aligned label before fixing: typing a longer name
gave `scrollHeight 40` against `clientHeight 36`, with `overflow: visible`.
The overlay is a `foreignObject`, which clips its content silently, so the
wrapped line was neither visible nor scrollable — it simply vanished.

The cause is that `resolveCanvasTextEditorFrame` sizes the frame from the
_committed_ bounds, before the longer name exists, and its height floor
(`54 + oneLine`) budgets a single line.

## Work

1. Budget three wrapped lines in the height floor instead of one.
2. Give `.rich-text-editable` `max-height: 100%` and `overflow-y: auto`, so
   anything past the frame scrolls rather than being clipped away.

## Validation

- `git diff --check`
- `git status --short --branch`
- Measured after fixing: `scrollHeight === clientHeight` for a 3-, 26-, and
  33-character name; a 400-character extreme now scrolls instead of clipping
- Full unit suite (1172 passed), full Playwright suite (203 passed)
- The new e2e case was re-run with the fix stashed and fails without it
- `tsc -p tsconfig.check.json`

## Gate Review

- Decision: affected
- Early gates: typecheck, Prettier on changed files
- Affected gates: the text-editing unit tests and the manual-editor
  Playwright spec that owns canvas text editing
- Final gates: remote GitHub Actions on the PR
- Platform risks: none; presentation-only

## Test Impact

- Decision: tests-updated
- Contracts: the editor frame's height budget and the editable's overflow
  behavior.
- Primary checks:
  `apps/editor/src/features/text-editing/canvas-text-editor-overlay.test.ts`,
  `apps/editor/e2e/manual-editor.spec.ts`

Four existing frame expectations encoded the one-line height and were updated
to the new geometry; the wrap budget and the overflow behavior are new
assertions.

## Commit Intent

Commit as:

```text
fix(editor): stop the canvas text editor clipping a wrapped label
```

## Outcome

A long label now fits the editor, and text beyond three lines scrolls instead
of disappearing.
