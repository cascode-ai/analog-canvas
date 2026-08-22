---
status: completed
experience: none
---

# Examples Panel Reads the Community Gallery

## Goal

Owner request: the editor's Examples side panel must show exactly what
the gallery shows — one source of truth. The panel now lists the
community gallery (same list endpoint as the landing feed, author as the
kicker) and opens entries through the same path as `/g/<id>` (which also
arms the publish dialog's update mode); the bundled starter examples
remain only as the offline/dev fallback when the worker is unreachable.
Separately (data, not code): the two bundled examples that never made it
into the production gallery were seeded with tags, and the two existing
seeds were retagged, so all four starters now live in the gallery
itself.

## State and Ownership

Branched from `origin/main` (post PR #179) as
`claude/examples-from-gallery`.

Owned paths:

- `apps/editor/src/features/editor-shell/examples-panel.tsx` (+ test)
- `apps/editor/src/app/App.tsx` (shared `openGalleryEntryById`, panel
  data load on open)
- `apps/editor/e2e/gallery.spec.ts`
- `docs/specs/community-gallery.md`, plan files

Shared dependencies: the gallery list/detail contracts (consumed as-is);
the bundled examples module stays untouched as the fallback and seed
source.

## Design

- App extracts the `/g/<id>` boot into `openGalleryEntryById` (fetch →
  strict parse → replace → remember entry context → status) and reuses
  it for panel clicks, so panel-opened entries are update-offerable too.
- Opening the panel fetches `/api/gallery?limit=60`; a non-empty result
  renders gallery cards (`gallery-example-<id>`, author kicker); null or
  empty keeps the bundled cards exactly as before (test ids unchanged),
  so offline development and every existing spec keep working.

## Validation

- `vitest`: panel renders gallery cards when provided and falls back to
  the bundled list otherwise
- `playwright`: with a mocked gallery, the Examples panel lists the
  community entries and opens one into the editor
- repository typecheck, prettier,
  `node scripts/check-test-impact.mjs --base origin/main`
- `git diff --check` and `git status --short --branch`

## Test Impact

- Decision: tests-updated
- Contracts: the panel and the feed read the same list; panel opens use
  the same entry path as `/g/<id>`; the bundled list appears exactly
  when the gallery is unreachable or empty
- Primary checks:
  `apps/editor/src/features/editor-shell/examples-panel.test.ts`,
  `apps/editor/e2e/gallery.spec.ts`

## Commit Intent

Committed on `claude/examples-from-gallery` under the user's standing
commit-push-merge direction as:

```text
feat(editor): examples panel reads the community gallery
```

## Outcome

Delivered. `openGalleryEntryById` is the one entry-opening path (boot
and panel; panel-opened entries arm the publish dialog's update mode);
opening the Examples panel fetches the same gallery list as the feed and
renders the community entries with author kickers, falling back to the
bundled starters exactly when the worker is unreachable or the gallery
is empty — offline dev and every pre-existing panel spec unchanged.
Production data: the two never-seeded bundled examples were published
(with tags) and the two original seeds retagged, so all four starters
live in the gallery (12 public entries at the time).
Validation: editor-shell units 26 (gallery/fallback markup), gallery
Playwright 18/18 (panel lists gallery, opens an entry, bundled testids
absent), existing examples e2e 2/2 untouched, repository typecheck,
prettier, test-impact, diff checks.
