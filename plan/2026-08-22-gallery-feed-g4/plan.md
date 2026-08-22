---
status: completed
experience: none
---

# Gallery Feed G4 Remainder: Infinite Scroll, Author Filter, Admin Bin

## Goal

Finish the three open G4 items. The feed pages through the existing
keyset cursor with an IntersectionObserver sentinel (masonry grows in
place); clicking a tile's author filters the wall to that author (server
filter + URL `?author=` + a clearable chip); and `/review` gains the
in-feed admin recycle-bin view (restore, delete-forever with
confirmation) so takedown management stops requiring curl.

## State and Ownership

Stacked on `claude/gallery-owner-editing` (PR #176) as
`claude/gallery-feed-g4`; merges cleanly over it.

Owned paths:

- `worker/gallery.ts` (+ test): author filter on the list op/route
- `apps/editor/src/components/gallery-feed.tsx` (paging state, sentinel,
  author chip and buttons)
- `apps/editor/src/components/review-queue.tsx` (admin bin section)
- `apps/editor/src/styles.css`, `apps/editor/e2e/gallery.spec.ts`
- `docs/specs/community-gallery.md`, roadmap, plan files

Shared dependencies: the list contract gains an optional `author` query
parameter (absent = unchanged behavior; every existing mock and consumer
keeps working because the client only appends parameters when set).

## Design

- List: `GET /api/gallery?limit&cursor&author` — `author` filters to the
  exact byline before keyset pagination; the DO op takes the same field.
- Feed state keeps `entries + nextCursor + author`; a sentinel div below
  the wall observes viewport intersection and appends the next page
  while a cursor remains (guarded against double-fires). Switching the
  author filter restarts from the first page and rewrites the URL query
  (`history.replaceState`); the initial filter reads from the URL.
- Tile bylines become buttons (stopping the tile link) that set the
  filter; an active filter renders a chip with a clear control.
- `/review` (admin only) appends a "Recycle bin" section listing
  `GET /api/gallery/recycled` with per-entry Restore and Delete forever
  (native confirm) wired to the existing admin routes.

## Validation

- `vitest`: worker list author-filter test
- `playwright`: gallery spec — sentinel auto-loads page two; author
  click filters the request and the chip clears; admin bin restores a
  mocked entry
- repository typecheck, prettier,
  `node scripts/check-test-impact.mjs --base origin/main`
- `git diff --check` and `git status --short --branch`

## Test Impact

- Decision: tests-updated
- Contracts: the plain list request is byte-compatible with before; the
  cursor pages the filtered set; the bin acts only behind admin review
  authority
- Primary checks: `worker/gallery.test.ts`,
  `apps/editor/e2e/gallery.spec.ts`

## Commit Intent

Committed on `claude/gallery-feed-g4` under the user's standing
commit-push-merge direction as:

```text
feat(editor): feed paging, author filter, and the admin recycle bin
```

## Outcome

Delivered. The list contract gained an optional exact-byline `author`
filter ahead of the unchanged keyset pagination (the plain request stays
byte-compatible); the feed keeps entries+cursor state, appends pages as
an IntersectionObserver sentinel enters the viewport (double-fire
guarded), and filters by author from clickable tile bylines with a
URL-carried, clearable chip (bundled fallback suppressed while
filtering). `/review` gained the admin recycle bin: restore and
confirm-guarded delete-forever over the existing admin routes.
Validation: worker gallery 14 (filtered paging), feed/component units 28,
gallery Playwright 16/16 (sentinel paging, author filter round-trip,
bin restore), repository typecheck, prettier, test-impact, diff checks.
