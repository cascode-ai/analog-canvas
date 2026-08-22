---
status: completed
experience: none
---

# Gallery Masonry Feed (G4, first slice)

## Goal

Replace the CSS multi-column wall (vertical fill order, ragged bottoms)
with a true Pinterest-style masonry the owner chose from rendered
comparisons: fixed-width columns computed from the container, every tile
keeping its circuit's natural aspect ratio, each tile greedily placed
into the currently shortest column (horizontal reading order, balanced
bottoms), relaid out on container resize and image load.

## State and Ownership

Branched from `origin/main` (post PR #164) as `claude/gallery-masonry`.

Owned paths:

- `apps/editor/src/components/masonry.tsx` (+ test) — reusable layout
  component with pure `masonryColumnCount`/`shortestColumn` helpers
- `apps/editor/src/components/gallery-feed.tsx` (tiles through Masonry)
- `apps/editor/src/styles.css` (absolute-tile rules, preview cap)
- `apps/editor/e2e/gallery.spec.ts` (top-row placement scenario)
- `docs/roadmap/community-gallery-platform.md` (G4 slice recorded)
- `plan/2026-08-22-gallery-masonry/plan.md`, `plan/log.md`

Shared dependencies: none — feed markup contracts (test ids, hrefs)
unchanged; tiles gain a positioning wrapper only.

## Design

Imperative layout, no React state: a `useLayoutEffect` measures the
container, derives `columnCount = max(1, floor((w+gap)/(min+gap)))` and
the equal column width, sets each wrapper's width, reads its height, and
assigns `translate(x, y)` into the shortest column (leftmost on ties, so
rows read left to right); container height becomes the tallest column. A
single `ResizeObserver` over the container and every wrapper re-runs the
layout when the window resizes or an image finishes loading; values
stabilize, so the observer settles. First layout runs before paint (no
overlap flash). Preview images keep natural ratio (cap 380px).

## Validation

- `vitest`: masonry helper tests (column count, greedy leftmost-shortest)
- `playwright`: gallery spec — three community tiles land on one top row
  in distinct columns; existing feed scenarios unchanged
- repository typecheck, prettier,
  `node scripts/check-test-impact.mjs --base origin/main`
- `git diff --check` and `git status --short --branch`

## Test Impact

- Decision: tests-updated
- Contracts: tiles keep natural aspect ratios in equal-width columns;
  placement is greedy shortest-column with horizontal reading order;
  layout follows container size and image loads
- Primary checks: `apps/editor/src/components/masonry.test.ts`,
  `apps/editor/e2e/gallery.spec.ts`

## Commit Intent

Committed on `claude/gallery-masonry` under the user's standing
commit-push-merge direction as:

```text
feat(editor): true masonry gallery feed
```

## Outcome

Delivered: the feed lays out through the reusable `Masonry` component —
equal-width columns from the container width, natural tile heights
(preview cap raised to 380px), greedy shortest-column placement with
leftmost tie-breaks so rows read left-to-right and bottoms balance, one
ResizeObserver re-running the imperative layout on resize and image
load, first pass before paint. Tile markup, test ids, and the
bundled-fallback contract are unchanged; the owner chose this option
from side-by-side renderings built with the seven live gallery entries.
Validation: masonry helper tests (component suite 13), gallery
Playwright 11/11 (new scenario asserts a left-to-right top row in
distinct columns and a measured container height), repository
typecheck, prettier, test-impact, diff checks.
