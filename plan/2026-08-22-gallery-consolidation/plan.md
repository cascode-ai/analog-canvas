---
status: completed
experience: none
---

# One gallery, previewed, and menus that earn their space

## Goal

Make the gallery the single place circuits are stored, show what each circuit
actually is, insert from it instead of replacing the canvas, and stop showing
controls that cannot do anything yet.

## State and Ownership

Branched from `origin/main` as `claude/gallery-consolidation`.

- `apps/editor/src/features/editor-shell/examples-panel.tsx`
- `apps/editor/src/components/{account,gallery-chrome,my-submissions,review-queue}.tsx`
- `apps/editor/src/app/App.tsx`, `styles.css`
- `apps/editor/src/document/user-examples-store.ts` (deleted)
- tests for the above

## Work

1. **Previews and columns.** Every card carries a rendering of the circuit: a
   name and a sentence do not tell you whether a circuit is the one you want
   to borrow from. A 1–4 column slider persists per browser.
2. **One store.** "My examples" and "Save as Example" are gone, along with
   their browser store. The gallery is where circuits live.
3. **Insert, don't replace.** Panel cards start a placement on the current
   canvas so part of a circuit can be borrowed. `beginProjectImportPlacement`
   is now shared by bundled examples and gallery entries; a hierarchical
   Project cannot be pasted as one fragment, so it falls back to opening.
4. **Menus.** Search moved into Edit. Manage Cells… joins it, and the whole
   hierarchy row appears only once there is a hierarchy to navigate.
5. **Gallery header.** Account actions collapse behind one disclosure — at
   half-screen width the badge, Review, My submissions, and Sign out each
   wrapped onto two lines. The redundant Gallery link is gone from the
   subpages.
6. Library and Gallery no longer both light up: the Library toggle was
   pressed whenever either panel was open.

## Validation

- Full unit suite (1188 passed), full Playwright suite (208 passed)
- Verified live: thumbnails render, the slider reaches three columns, and only
  the active panel toggle is pressed
- `tsc -p tsconfig.check.json`, Prettier, `git diff --check`

## Gate Review

- Decision: full
- Early gates: typecheck, Prettier
- Affected gates: editor-shell unit tests plus the component-insert, gallery,
  hierarchy, and manual-editor Playwright specs
- Final gates: remote GitHub Actions
- Platform risks: the panel's width changed, which shifts pixel-to-logical
  mapping for canvas tests, so the whole browser suite was run.

## Test Impact

- Decision: tests-updated
- Contracts: where circuits are stored, what a panel card does, and which
  chrome appears for a flat Project.
- Primary checks:
  `apps/editor/src/features/editor-shell/examples-panel.test.ts`,
  `apps/editor/e2e/{component-insert,gallery,hierarchy,manual-editor}.spec.ts`

Removed rather than rewritten: the saved-snapshot cases went with the feature.
The hierarchy-row case was rewritten to assert the new rule from both sides —
absent for a flat Project, present once a Cell exists.

## Commit Intent

```text
feat(editor): one previewed gallery and menus that earn their space
```

## Outcome

The gallery panel previews each circuit, inserts into the current canvas, and
is the only place circuits are stored. A flat Project no longer carries
hierarchy controls, and the gallery header stays readable at half width.
