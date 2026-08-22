# Owner withdrawal and owner-visible version history

- status: complete
- experience: The gallery's lifecycle surfaces were reviewer-only:
  ordinary authors could not take their own entry off the wall, and
  could not see the version snapshots their own updates create. The
  owner asked for both: 普通用户可撤回自己的作品，普通作者可查看自己的
  版本历史。

## Goal

An entry's owner manages its lifecycle without reviewer powers:
withdraw it from the gallery (soft, restorable), bring it back (through
review, since the pre-withdrawal status is not recorded), and browse or
restore its version history (a restore is an owner edit and re-enters
review).

## Changes

- `worker/gallery.ts`
  - New `entryManager(request, env, id)` helper: `{found, reviewer,
owner}` for one entry's management surfaces.
  - `POST /:id/recycle|restore`: same-origin; admin keeps full
    authority; the owning session may withdraw and restore its own
    entry. Owner restore targets `pending` (admin restore stays
    `public`). Unknown entries answer 404 before the authority check.
  - Versions routes (list, version preview, restore): now reviewer OR
    owner. Restore passes `pending: !reviewer`; the `restore-version`
    op sets `status='pending', reject_reason=NULL` inside the same
    transaction when asked.
- `apps/editor/src/components/my-submissions.tsx` — per-entry actions:
  two-step Withdraw, Restore (labelled as re-entering review), Version
  history dialog; notices and reload after each action; `recycled`
  status labelled "Withdrawn" with an explanation.
- `apps/editor/src/components/version-history-dialog.tsx` — moved from
  `features/editor-shell/` so `/mine` (components layer) can reuse it;
  App import updated.
- `apps/editor/src/features/editor-shell/publish-gallery-dialog.tsx` —
  the "Version history…" link now renders for anyone with an update
  target (owners included), not only privileged sessions.
- `apps/editor/src/styles.css` — mine-card action row and withdraw
  button styles.
- `docs/specs/community-gallery.md` — owner withdrawal contract,
  version-history authority, admin-route notes.

## Test Impact

- Decision: tests-updated
- Contracts: entry lifecycle authority (owner withdrawal/restore with
  review re-entry; owner-visible version history; stranger/anonymous
  denial), unchanged admin curation.
- Primary checks: `node_modules/.bin/vitest run worker/gallery.test.ts`
  (two new owner-lifecycle tests; the bearer-guard test now expects 404
  for an unknown entry since ownership is resolved first);
  `node_modules/.bin/playwright test apps/editor/e2e/gallery.spec.ts
--grep "owner withdrawal"` (new `/mine` actions spec).

## Validation

- Worker vitest: 19 passed. Editor e2e (mine + history specs): 3
  passed. `tsc --noEmit -p tsconfig.check.json` clean. Prettier on
  touched files; `git diff --check`.
