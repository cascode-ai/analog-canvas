---
status: completed
experience: none
---

# A usable editor on a half-screen window

## Goal

Make the editor work on a window occupying half a Mac screen, and remove the
chrome that says the same thing twice.

## State and Ownership

Branched from `origin/main` as `claude/chrome-half-screen`.

- `apps/editor/src/app/App.tsx`
- `apps/editor/src/styles.css`
- `apps/editor/src/features/editor-shell/use-editor-panels.ts`
- `apps/editor/src/components/editor-help-dialog.tsx`
- `apps/editor/src/components/editor-about-dialog.tsx` (deleted)
- co-located and Playwright tests for the above

## Defects, each reproduced at 760px before fixing

1. **File and Edit would not open.** `.app-command-surface` carries
   `overflow-x: auto` below 900px so the menubar can scroll, and that clipped
   its own 414px dropdown. Measured `panel.bottom 456` against a surface only
   tall enough for the bar. The surface now stops clipping while a menu is
   open, which is what a toolbar row already does.
2. **The Library could not be opened.** In compact layout an effect closed the
   Library whenever Properties was open, so the toggle appeared dead. The rule
   now runs the other way: whichever panel the user just opened wins.
3. **The Library could not be widened.** The compact grid pinned the column to
   `min(8rem, 34vw)`, overriding the dragged width. It now uses
   `min(var(--icm-shapes-width), 60vw)`, so dragging works — verified 248px →
   328px with a real pointer drag.

## Work

1. Move Examples and Library out of the vertical rail into the head of the
   horizontal drawing toolbar and delete the rail, returning its column to the
   canvas.
2. Fold About into Help as a section and remove the second entry.
3. Remove the toolbar's "← Gallery" link; the brand mark already goes there.

## Test Impact

- Decision: tests-updated
- Contracts: panel toggle placement, narrow-layout panel behavior, the single
  About surface, and the single route back to the gallery.
- Primary checks: `apps/editor/src/app/App.test.tsx`,
  `apps/editor/e2e/{component-insert,chrome-isolation,gallery,manual-editor}.spec.ts`

Two manual-editor cases failed for a reason worth recording: removing the rail
widens the canvas, so a canvas-relative pixel maps to a different logical
point. In one, the branch wire landed 10 units off and left two arms pointing
the same way, so no Junction dot was drawn at all — the assertion was correct
and the geometry had moved. Both cases were re-aimed rather than relaxed.

## Validation

- Full unit suite (1187 passed); full Playwright suite (208 passed)
- Each defect reproduced at 760px first and re-checked in the running editor
- `tsc -p tsconfig.check.json`, Prettier, `git diff --check`

## Gate Review

- Decision: full
- Early gates: typecheck, Prettier
- Affected gates: editor unit tests and the four affected Playwright specs
- Final gates: remote GitHub Actions
- Platform risks: the layout change shifts pixel-to-logical mapping for every
  canvas test, so the whole browser suite was run rather than a subset.

## Commit Intent

```text
fix(editor): make the editor usable on a half-screen window
```

## Outcome

At 760px the menus open, the Library opens and drags, the toolbar is one
horizontal row, and the header no longer carries two ways to reach the gallery
or two places to read the version.
