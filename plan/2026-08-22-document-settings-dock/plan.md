---
status: completed
experience: none
---

# Document settings dock beside the canvas

## Goal

Let document-wide settings be adjusted while their effect is visible, and put
the MOS bulk defaults where they actually belong.

## State and Ownership

Branched from `origin/main` as `claude/properties-cleanup`.

- `apps/editor/src/features/editor-shell/document-settings-section.tsx` (new)
- `apps/editor/src/features/editor-shell/style-knobs.ts` (was `style-dialog.tsx`)
- `apps/editor/src/app/App.tsx`
- tests for the above

## Why

The style knobs rescale what the canvas is drawing, but they lived in a modal
that covered the canvas, so a change could not be judged while it was made.
They now dock as a "Document" section in the Properties sidebar; the toolbar's
Style button toggles it.

The Default NMOS/PMOS bulk Net selects sat in a transistor's own Bulk section,
which reads as a per-instance setting. One Net answers for every NMOS or PMOS
in the Document, so they move into the same Document section.

## Work

1. Add `DocumentSettingsSection` rendering the five style knobs, a reset, and
   the two Document-wide bulk defaults.
2. Toggle it from the Style toolbar button, opening the sidebar with it.
3. Remove the two bulk selects from the per-instance Bulk section.
4. Delete the now unrendered modal, keeping its pure knob helpers, and rename
   the module to `style-knobs.ts` to match what it holds.
5. Report background-dot visibility in the status bar; that control changed
   the canvas silently while every neighbouring control reports.

## Validation

- Full unit suite (1189 passed), full Playwright suite (209 passed)
- Verified live in the editor: with the section docked, Font size 1× → 2×
  moved the rendered label from `15.116` to `30.232` with the canvas visible
  throughout
- `tsc -p tsconfig.check.json`, Prettier, `git diff --check`

## Gate Review

- Decision: affected
- Early gates: typecheck, Prettier
- Affected gates: editor-shell unit tests, the manual-editor Playwright spec
  that owns document style
- Final gates: remote GitHub Actions
- Platform risks: none

## Test Impact

- Decision: tests-updated
- Contracts: where document-wide settings live and that they apply live.
- Primary checks:
  `apps/editor/src/features/editor-shell/document-settings-section.test.tsx`,
  `apps/editor/e2e/manual-editor.spec.ts`

The modal's four component tests were replaced rather than dropped: the pure
knob helpers keep direct coverage, the new section has its own rendering test,
and the Playwright case now asserts the canvas stays visible while a knob moves.

## Commit Intent

```text
feat(editor): dock document settings beside the canvas
```

## Outcome

Style knobs and the Document-wide bulk defaults now sit in one Document
section in the sidebar, adjustable while the canvas stays visible.
