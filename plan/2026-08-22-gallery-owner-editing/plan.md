---
status: completed
experience: none
---

# Gallery Chrome Everywhere and Owner Editing (G3 completion)

## Goal

Three owner-reported gaps. (1) `/mine` and `/review` lose the site
header entirely in their loading/signed-out/denied states and render a
bare paragraph touching the viewport edge; every state of both pages
gets the standard gallery chrome (brand, account menu, New Circuit) via
one shared component, with centered, padded content. (2) Published
content must stay editable: every entry remains updatable by its owner
(and by admin/moderators for any entry) — open it from `/mine` or its
tile, edit, and the publish dialog offers "update this entry"; an
ordinary owner's update re-enters review (this also turns a rejection
into an informed resubmission), admin updates keep the current status.
This closes the G3 follow-up recorded in the roadmap.

## State and Ownership

Branched from `origin/main` (post PR #173) as
`claude/gallery-owner-editing`.

Owned paths:

- `apps/editor/src/components/gallery-chrome.tsx` (new shared header)
- `apps/editor/src/components/gallery-feed.tsx`, `review-queue.tsx`,
  `my-submissions.tsx` (chrome + layout + open/edit links + previews)
- `worker/gallery.ts` (+ test): `replace-entry` op, `PUT
/api/gallery/<id>`, `ownerUserId` in the detail response
- `apps/editor/src/features/editor-shell/gallery-publish.ts(.test.ts)`
  (`updateGalleryEntry`) and `publish-gallery-dialog.tsx(.test.tsx)`
  (update mode)
- `apps/editor/src/app/App.tsx` (gallery-entry context, update wiring),
  `styles.css`, `apps/editor/e2e/gallery.spec.ts`
- `docs/specs/community-gallery.md`, roadmap, plan files

Shared dependencies: feed header markup contracts (test ids preserved
verbatim inside the shared component).

## Design

- `PUT /api/gallery/<id>` (same-origin): 401 without any authority; the
  bearer and admin/moderator sessions may update any entry keeping its
  current status; an ordinary session must own the entry (403 otherwise)
  and passes the quality gates (422), after which the entry re-enters
  review as `pending` with reviewer fields cleared. Fields and caps
  match submissions; the Project is re-serialized canonically and the
  preview re-rendered. 200 `{id, status}`.
- The public/owner detail response gains `ownerUserId` so the editor can
  decide whether to offer updating.
- App remembers which gallery entry the session opened (`/g/<id>` boot);
  when the publish dialog opens and the signed-in user may update it
  (owner, admin, or moderator), the dialog defaults to "Update this
  gallery entry" with a switch back to "Publish as new".
- `/mine` cards gain the owner-visible preview thumbnail and an "Open in
  editor" link (`/g/<id>` already serves owners their pending/rejected
  entries).

## Validation

- `vitest`: worker gallery update tests (owner re-entry, admin
  keep-status, 403 stranger, gates), publish client update mapping,
  dialog update-mode markup
- `playwright`: gallery spec — `/mine` shows chrome, thumbnails, reason,
  and the editor offers and posts an update for an opened entry
- repository typecheck, prettier,
  `node scripts/check-test-impact.mjs --base origin/main`
- `git diff --check` and `git status --short --branch`

## Test Impact

- Decision: tests-updated
- Contracts: every page state carries the standard chrome; an entry is
  updatable exactly by its owner and reviewers; ordinary updates
  re-enter review with the rejection reason cleared; gates guard
  ordinary updates like submissions
- Primary checks: `worker/gallery.test.ts`,
  `apps/editor/e2e/gallery.spec.ts`

## Commit Intent

Committed on `claude/gallery-owner-editing` under the user's standing
commit-push-merge direction as:

```text
feat(editor): shared gallery chrome and owner entry editing
```

## Outcome

Delivered. Every gallery page state (feed, /mine, /review — loading,
signed-out, denied, ready) now wears the one shared `GalleryChrome`
(brand, account menu, New Circuit, Gallery link on subpages) with
centered padded content, ending the bare edge-touching paragraphs.
`PUT /api/gallery/<id>` lets the bearer and admin/moderator sessions
update any entry in place (status kept) and lets an ordinary owner
update their own — through the quality gates, re-entering review with
the previous decision cleared, which turns a rejection into an informed
resubmission. The detail response names the owner; the editor remembers
which entry it opened and the publish dialog defaults to "Update the
opened gallery entry" (switchable to publish-as-new) with role-aware
labels; `/mine` cards gained owner-visible preview thumbnails,
open-in-editor links, and resubmission guidance under rejections.

Validation: worker gallery suite 13 (owner re-entry walk-through,
stranger 403, anonymous 401, admin keep-status, gate 422, ownerUserId in
detail), editor+worker unit sweep 472, gallery Playwright 13/13 (new:
/mine chrome with thumbnails and links; opened-entry update posting the
PUT), repository typecheck, prettier, test-impact, diff checks.
