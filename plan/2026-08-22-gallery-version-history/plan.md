---
status: completed
experience: none
---

# Gallery Version History

## Goal

Owner-approved after a real overwrite loss: every content-replacing
update of a gallery entry first snapshots the previous state (project
text, preview, name, author, description, tags) into a per-entry
version history (capped at 20, oldest pruned). Reviewers browse an
entry's history from the publish dialog's update mode and can Restore
any version — restoring snapshots the current state first, so restores
are themselves reversible.

## State and Ownership

Branched from `origin/main` (post PR #187) as
`claude/gallery-version-history`.

Owned paths:

- `worker/gallery.ts` (+ test): `gallery_entry_versions` table,
  snapshot inside `replace-entry`, `versions`/`version`/
  `restore-version` ops, reviewer routes (list, version preview,
  restore)
- `apps/editor/src/features/editor-shell/version-history-dialog.tsx`
  (+ test) and `publish-gallery-dialog.tsx` (history link in update
  mode)
- `apps/editor/src/app/App.tsx` (dialog wiring), `styles.css`,
  `apps/editor/e2e/gallery.spec.ts`
- `docs/specs/community-gallery.md`, plan files

Shared dependencies: the update/restore semantics reuse the entry
replacement op; entry contracts otherwise unchanged.

## Design

- Table `gallery_entry_versions(id, entry_id, version_no, name, author,
description, tags, schema_version, project_text, svg_text,
created_at)`; created guarded like other additive schema.
- `replace-entry` snapshots the pre-update row in the same transaction,
  assigns the next version number, prunes beyond 20 per entry.
  Maintenance re-serialization (`update-entry`) does NOT snapshot —
  content-equivalent canonicalization would only spam versions.
- Routes (reviewer authority — bearer, admin, or moderator):
  `GET /api/gallery/<id>/versions` (newest first),
  `GET /api/gallery/<id>/versions/<versionId>/preview.svg`,
  `POST /api/gallery/<id>/versions/<versionId>/restore` — restore
  replaces entry content/metadata from the version (status kept) via
  the same snapshotting op.
- UI: the publish dialog's update mode (reviewer session) links
  "Version history…"; the dialog lists versions with preview
  thumbnails, timestamps, and per-version Restore.

## Validation

- `vitest`: worker — update snapshots, list order, restore round-trip
  (including the pre-restore snapshot), 20-cap prune, 401 without
  reviewer authority; dialog markup test
- `playwright`: reviewer opens an entry, reaches Version history from
  the publish dialog, restores a mocked version
- repository typecheck, prettier,
  `node scripts/check-test-impact.mjs --base origin/main`
- `git diff --check` and `git status --short --branch`

## Test Impact

- Decision: tests-updated
- Contracts: every replace snapshots first; restores are snapshots too;
  history is reviewer-only and capped at 20
- Primary checks: `worker/gallery.test.ts`,
  `apps/editor/e2e/gallery.spec.ts`

## Commit Intent

Committed on `claude/gallery-version-history` under the user's standing
commit-push-merge direction as:

```text
feat(worker): gallery entry version history with restore
```

## Outcome

Delivered. `replace-entry` (updates and restores alike) snapshots the
previous state transactionally into `gallery_entry_versions` (per-entry
numbering, newest-20 cap with pruning); reviewer routes list versions,
serve their stored previews, and restore — restore snapshots current
first, so it is reversible. The publish dialog's update mode links
"Version history…" (reviewer sessions) to a dialog with thumbnails,
timestamps, and per-version Restore; a restore reloads the entry into
the editor. Spec updated. Validation: worker gallery 17 (snapshot on
update, list order, reversible restore round-trip, 20-cap prune,
anonymous 401), editor-shell+worker units 78, gallery Playwright 21/21
(history reached from the dialog, restore posted and entry reloaded),
repository typecheck, prettier, test-impact, diff checks.
