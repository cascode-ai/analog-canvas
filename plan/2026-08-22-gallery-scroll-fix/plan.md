---
status: completed
experience: none
---

# Hotfix: Gallery Pages Scroll Inside Their Shell

## Goal

User-reported: the masonry feed cannot be scrolled. Root cause: the
editor locks `#root`/`body` with `overflow: hidden` and a fixed height
for the canvas, so the gallery pages had no scroll container at all —
anything below the first viewport was unreachable (and lazy previews
below the fold could never load). Give `.gallery-shell` and
`.review-shell` their own scrolling (`height: 100%; overflow-y: auto`),
which also restores lazy-image loading and sentinel paging semantics.

## State and Ownership

Branched from `origin/main` as `claude/gallery-scroll-fix`.

Owned paths: `apps/editor/src/styles.css`,
`apps/editor/e2e/gallery.spec.ts`,
`plan/2026-08-22-gallery-scroll-fix/plan.md`, `plan/log.md`.

## Validation

- `playwright`: gallery spec — new scenario proves the shell is the
  scroller (overflow auto, scrollHeight beyond the viewport, scrollTop
  advances) on a small viewport with eight tiles
- prettier, `node scripts/check-test-impact.mjs --base origin/main`
- `git diff --check` and `git status --short --branch`
- Production verification after deploy

## Test Impact

- Decision: tests-updated
- Contracts: gallery pages scroll within their shell under the locked
  app root
- Primary checks: `apps/editor/e2e/gallery.spec.ts`

## Commit Intent

Committed on `claude/gallery-scroll-fix` under the user's standing
commit-push-merge direction as:

```text
fix(editor): gallery pages scroll inside their shell
```

## Outcome

Delivered: `.gallery-shell`/`.review-shell` own their scrolling beneath
the overflow-hidden app root; verified live in the dev editor (shell
scrolls to its full masonry height) and pinned by the new Playwright
scenario. During diagnosis, the apparent ResizeObserver silence was
traced to the debugging browser's hidden document (paused rendering
pipeline), not to product code.
