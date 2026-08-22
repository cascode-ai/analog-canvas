---
status: completed
experience: none
---

# Gallery Circuit Tags

## Goal

Owner request: every circuit can carry category tags (amplifier,
comparator, ADC, PLL, …). Submitters set tags when publishing and can
change them any time through the existing owner-update path; the feed
gains a multi-select tag menu that narrows the wall to circuits carrying
ANY selected tag (URL-carried, combinable with the author filter), and
tile tags are clickable shortcuts into that selection.

## State and Ownership

Stacked on `claude/gallery-feed-g4` (PR #178) as `claude/gallery-tags`.

Owned paths:

- `worker/gallery.ts` (+ test): `tags` column (guarded ALTER),
  `sanitizeGalleryTags`, tags through submit/replace/list/summary, the
  `GET /api/gallery/tags` aggregate
- `apps/editor/src/features/editor-shell/gallery-publish.ts(.test.ts)`
  and `publish-gallery-dialog.tsx(.test.tsx)`: tags field, editor chips
  with presets, update-mode prefill of author/description/tags
- `apps/editor/src/components/gallery-feed.tsx` (multi-select tag bar,
  tile tag chips), `apps/editor/src/app/App.tsx` (entry context fields),
  `styles.css`, `apps/editor/e2e/gallery.spec.ts`
- `docs/specs/community-gallery.md`, plan files

Shared dependencies: submissions/update/list contracts gain optional
`tags`; absent tags keep every existing request and mock byte-identical.

## Design

- Normalization (`sanitizeGalleryTags`): trim, lowercase, collapse inner
  whitespace, keep `[a-z0-9 +/-]`, ≤24 chars each, deduplicate, at most 5. Stored comma-wrapped (`,amp,adc,`) so the list filter is a keyset-
  compatible `tags LIKE '%,t,%'` OR-union, ANDed with author/cursor.
- `GET /api/gallery?tags=a,b` filters to entries carrying any selected
  tag; `GET /api/gallery/tags` returns `{tags: [{tag, count}]}` over
  public entries, most frequent first.
- Publish dialog: a chip editor (type + Enter/comma, preset shortcuts,
  cap 5); in update mode the entry's current author, description, and
  tags prefill once so "edit tags any time" is one open-edit-save loop.
- Feed: a toggleable multi-select chip bar under the chrome (from the
  aggregate), selections carried in `?tags=`, tiles render their tags as
  chips that add to the selection.

## Validation

- `vitest`: sanitize rules; worker tags round-trip (submit → filtered
  list OR-semantics → aggregate → update rewrites tags)
- `playwright`: publish posts chosen tags; feed multi-select narrows the
  request and tiles' tag chips join the selection
- repository typecheck, prettier,
  `node scripts/check-test-impact.mjs --base origin/main`
- `git diff --check` and `git status --short --branch`

## Test Impact

- Decision: tests-updated
- Contracts: tags normalize identically everywhere; absent tags change
  nothing; the multi-select is an OR-union ANDed with other filters;
  owner updates rewrite tags
- Primary checks: `worker/gallery.test.ts`,
  `apps/editor/e2e/gallery.spec.ts`

## Commit Intent

Committed on `claude/gallery-tags` under the user's standing
commit-push-merge direction as:

```text
feat(editor): circuit tags with a multi-select feed filter
```

## Outcome

Delivered. Tags flow through one normalization (`sanitizeGalleryTags`)
into submissions, owner/reviewer updates (editable any time), summaries,
the comma-wrapped LIKE filter (`?tags=a,b`, OR-union ANDed with
author/cursor), and the `GET /api/gallery/tags` aggregate. The publish
dialog gained a chip editor with preset shortcuts (cap 5, Enter/comma,
removable chips) that prefills the opened entry's author, description,
and tags once in update mode; the feed gained the multi-select tag menu
with counts (URL-carried, clearable) and tile tag chips that join the
selection. Validation: worker gallery 15 (normalize/filter/aggregate/
update round-trip), editor-shell+components units 54, gallery Playwright
17/17 (publish posts chosen tags; menu multi-select narrows requests and
URL; tile chips join selection), repository typecheck, prettier,
test-impact, diff checks.
