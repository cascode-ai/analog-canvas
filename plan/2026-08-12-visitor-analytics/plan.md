---
status: active
experience: none
---

# Visitor Analytics

## Goal

Add the privacy-friendly first-party visitor counts and geographic/source
analytics used by the local Analog Arena site to Analog Canvas, with a compact
editor entry point and an independent `/analytics` dashboard.

## State and Ownership

Start state from `git status --short --branch`:

```text
## main...origin/main
```

The worktree was clean before creating `codex/visitor-analytics`. This target
owns:

- `worker/**`
- `wrangler.jsonc`
- `vitest.config.ts`
- `.gitignore`
- `apps/editor/src/main.tsx`
- `apps/editor/e2e/manual-editor.spec.ts`
- `apps/editor/src/app/App.tsx`
- `apps/editor/src/app/App.test.tsx`
- `apps/editor/src/components/analytics-page.tsx`
- `apps/editor/src/lib/world-map.ts`
- `apps/editor/src/data/land-110m.json`
- `apps/editor/src/styles.css`
- focused analytics tests under `apps/editor/src/**`
- `plan/2026-08-12-visitor-analytics/plan.md`
- `plan/log.md`

Read-only references are the local Analog Arena analytics implementation under
`/Users/tokenzhang/Documents/analog-arena/site/`. Existing circuit model,
editing, export, and canvas behavior are outside this target.

## Work

1. Add a Worker entry point and SQLite-backed Durable Object for PV/UV, daily
   counts, country, coarse location, source, and page breakdowns.
2. Accept only same-origin, non-bot, non-DNT events; retain no IP, full
   referrer URL, query, or search term.
3. Add a non-tracked `/analytics` dashboard and compact PV/UV link in the
   editor header.
4. Configure the Durable Object migration and keep Worker-first routing limited
   to `/api/*`.
5. Pass local and remote gates, merge, deploy, and verify live recording and
   dashboard reads.

## Validation

- focused Vitest tests for analytics helpers and editor entry point
- `pnpm typecheck`
- `pnpm --filter @icm/editor... build`
- `pnpm dlx wrangler@4.120.1 deploy --dry-run`
- `pnpm install --frozen-lockfile && pnpm ci:check`
- GitHub Actions required checks
- Cloudflare deployment workflow on `main`
- live `/api/track`, `/api/stats`, `/api/analytics`, and `/analytics` checks
- `git diff --check`
- `git status --short --branch`

The full canonical gate is required because this adds a production Worker,
persistent storage, cookies, and a public dashboard.

Local validation passed 475 unit/integration tests, release contracts, the new
analytics browser test, and 72 of 74 complete browser tests. The two remaining
failures are the pre-existing rich-text `span` expectations in
`drafting.spec.ts`; this target does not change drafting behavior, and the
review branch still requires the complete remote CI matrix to pass before
merge.

## Commit Intent

Commit as:

```text
feat(web): add privacy-friendly visitor analytics
```

## Outcome

To be recorded after production verification.
