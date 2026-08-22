# Exempt privileged submitters from the daily gallery quota

- status: complete
- experience: The owner hit "Daily publish limit reached — try again
  tomorrow" on their own gallery. The 10-per-day hashed-IP quota was
  applied to every submission path, including the bearer and
  admin/moderator sessions, so a curation session that published or
  updated more than ten entries in a UTC day locked itself out.

## Goal

The daily submission quota is anti-garbage protection for ordinary and
anonymous submitters. Privileged submitters (bearer token, admin
session, moderator session) publish directly and curate the gallery;
they must never be rate-limited by their own protection.

## Changes

- `worker/gallery.ts`
  - `GalleryDO.submit` reads `body.enforceLimit !== false`; the quota
    SELECT / 429 / counter-increment run only when enforced. The entry
    INSERT is unchanged and stays inside the same transaction.
  - `handleSubmission` passes `enforceLimit: !privileged` (privileged =
    bearer, admin, or moderator — the same flag that already selects
    direct-`public` publishing and skips the quality gates).
- `worker/gallery.test.ts` — reworked the rate-limit test: enforced
  submissions (direct DO op) hit 429 after 10 without touching another
  submitter hash; bearer submissions exceed the limit and all succeed.
- `docs/specs/community-gallery.md` — quota sentence now scopes the
  limit to ordinary/anonymous submissions and records the exemption.

## Test Impact

- Decision: tests-updated
- Contracts: the daily submission quota applies to ordinary/anonymous
  submissions only; privileged submissions bypass it.
- Primary checks: `node_modules/.bin/vitest run worker/gallery.test.ts`
  ("rate-limits ordinary submitters per day; curators are exempt"
  covers both the enforcement and the exemption).

## Validation

- `node_modules/.bin/vitest run worker/gallery.test.ts` — 17 passed.
- `node_modules/.bin/tsc --noEmit -p tsconfig.check.json` — clean.
- Prettier on touched files; `git diff --check`.
