---
status: active
experience: none
---

# Cloudflare Deployment

## Goal

Deploy the existing editor at `analog-canvas.tokenzhang.com` as a Cloudflare
Workers Static Assets application and make future `main` updates deploy
automatically through GitHub Actions.

## State and Ownership

Start state from `git status --short --branch`:

```text
## main...origin/main
```

The worktree was clean before creating `codex/cloudflare-deployment`. This
target owns only the deployment configuration and its required project records:

- `wrangler.jsonc`
- `.github/workflows/cloudflare.yml`
- `plan/2026-08-12-cloudflare-deployment/plan.md`
- `plan/log.md`

External GitHub Actions secrets are also configured for the repository but are
never written to tracked files. Existing application source, build output, and
the GitHub Pages workflow are read-only.

## Work

1. Configure a Worker that serves `apps/editor/dist` with SPA fallback and the
   `analog-canvas.tokenzhang.com` custom domain.
2. Add a `main`-branch GitHub Actions workflow that builds and deploys it.
3. Store the required Cloudflare values as GitHub Actions secrets.
4. Validate locally, pass the repository delivery gate on a review branch,
   merge, and verify the production URL.

## Validation

- `pnpm install --frozen-lockfile`
- `pnpm ci:check`
- `pnpm --filter @icm/editor... build`
- `pnpm dlx wrangler deploy --dry-run`
- GitHub Actions required checks on the review branch
- Cloudflare deployment workflow on `main`
- HTTP request to the deployed Worker URL
- `git diff --check`
- `git status --short --branch`

The full canonical gate is required because this non-document change will be
merged to `main` and introduces a production delivery path.

Local `pnpm ci:check` passed static contracts, 472 unit/integration tests, the
release build/contracts, and 71 of 73 browser tests. The two failures are the
pre-existing rich-text `span` expectations in `drafting.spec.ts`; this target
does not modify application or test code, and the same `41f5034` baseline passed
all remote CI jobs. The review branch still requires the complete remote CI
matrix to pass before merge.

## Commit Intent

Commit as:

```text
ci: deploy editor to Cloudflare Workers
```

## Outcome

To be recorded after deployment verification.
