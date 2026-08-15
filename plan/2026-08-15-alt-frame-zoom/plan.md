---
status: completed
experience: none
---

# Alt+drag frame-zoom alias

## Goal

The right-drag frame zoom shipped in PR #75 is unusable on machines whose
system-level software (screenshot tools, mouse-driver gestures) hooks
right-button drag before the browser receives the events. A webpage cannot
block system-level mouse hooks, so add an in-app equivalent gesture that
does not depend on the right button: **Alt + left-drag** from empty canvas
frames a region and fits the camera, sharing the existing zoom-box pipeline
and preview. Right-drag remains the primary gesture.

## State and Ownership

Start state from `git status --short --branch` in the isolated worktree
`.worktrees/alt-frame-zoom` (branch `agent/alt-frame-zoom` from `origin/main`
at `3a616d9`):

```text
## agent/alt-frame-zoom
```

Clean. The main checkout is parked on another worker's branch
(`codex/add-about-help-panel`), so this target works in a dedicated worktree
to avoid ownership collisions; only `node_modules`/tooling state differs.

- Owned: `apps/editor/src/app/App.tsx` (gesture branch only),
  `apps/editor/e2e/manual-editor.spec.ts` (zoom test only),
  `docs/specs/editor-interaction.md` (gesture contract note)
- Read-only: camera math (`fit-view.ts`), clipboard, netlist-authoring
- Shared contracts: none beyond the editor-interaction spec text

## Work

1. `beginCanvasGesture`: treat `button === 0 && altKey` (empty canvas, no
   active placement/tool mode — same guards as the right-button branch) as
   the zoom-frame intent, entering the same `boxPreview` zoom pipeline.
2. Extend the manual-editor zoom e2e test with an Alt+left-drag variant that
   asserts the frame preview, the camera change, and unchanged revision.
3. Document both gestures in `docs/specs/editor-interaction.md`.

## Validation

- `git diff --check`, `git status --short --branch`
- `pnpm typecheck`, Prettier on touched files
- `pnpm test:e2e:local apps/editor/e2e/manual-editor.spec.ts --grep "frames a region"`

## Commit Intent

Commit as:

```text
feat(editor): alt-drag frame-zoom alias for blocked right buttons
```

## Outcome

Delivered: Alt+left-drag from empty canvas now enters the same frame-zoom
pipeline as right-drag (one shared `frameZoomDrag` entry in
`beginCanvasGesture`; identical guards, preview, and commit). The gesture
contract is documented in `docs/specs/editor-interaction.md`, and the
manual-editor frame-zoom e2e test gained an Alt-drag variant asserting the
preview, camera change, and unchanged revision.

Validation: typecheck 0 errors; Prettier clean; Playwright frame-zoom test
(right-drag + Alt-drag) passed, plus full manual-editor 66/66 and
component-insert 17/17. One environmental trap was hit and resolved: a
zombie vite dev server on port 4173 (left over from a half-removed worktree)
served stale modules and made the first Alt-drag run fail; killing the
process and rerunning against the correct server passed. Playwright test
discovery also ignores specs under gitignored paths, so this target's
worktree lives as a sibling directory (`interactive Circuit maker-alt-frame-zoom`),
matching the repository's existing multi-worktree convention.

status: completed
experience: none
