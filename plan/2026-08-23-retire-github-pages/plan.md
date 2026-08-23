---
status: completed
experience: none
---

# Retire the GitHub Pages deployment

## Goal

Leave one public deployment. The Cloudflare Worker already serves the editor
and everything behind it; the Pages copy was broken and stated things about
the product that are no longer true.

## What the diagnosis found

- The Pages workflow has been `disabled_manually` since about 13 August, well
  before the repository move, so no build has run since 9 August.
- That last build baked the repository name into every asset path through
  `ICM_PAGE_BASE_PATH: ${{ github.event.repository.name }}`. Renaming the
  repository changed the serving path but not the baked prefix, so the site
  returns 200 and then loads nothing: its HTML asks for
  `/interactive-circuit-maker/assets/…` (404) while the files sit at
  `/analog-canvas/assets/…` (200).
- The old Pages URL 404s outright — Pages does not redirect the way the
  repository path does.

## Work

1. Delete `.github/workflows/pages.yml`.
2. Drop `pageBasePath` from the Vite config. It existed only to serve a
   repository sub-path; the Worker serves from a domain root, so `base` is
   simply `/`.
3. Replace the guide's "GitHub Pages release" section with one describing the
   deployment that actually exists. The old text claimed the deployment has
   "no public Agent API, account system, or backend endpoint", which was true
   of a static Pages build and is false of the Worker.

## Validation

- Full unit suite (1192 passed), full Playwright suite (211 passed)
- Production build succeeds and emits root-relative assets; the bundle hash
  matches the one currently served by Cloudflare, so the output is unchanged
- `tsc -p tsconfig.check.json`, Prettier, markdown link check

## Gate Review

- Decision: affected
- Early gates: typecheck, Prettier, markdown links
- Affected gates: the editor production build, since `base` changed
- Final gates: remote GitHub Actions, and the Cloudflare deploy that follows
- Platform risks: `base` feeds every asset URL, so the built `index.html` was
  inspected rather than assumed.

## Test Impact

- Decision: no-test-change
- Reason: no runtime behavior changes. `pageBasePath` had no test, and the
  deployment path it served is being removed rather than altered.
- Existing protection: the production build itself, whose emitted asset paths
  were checked against the live bundle.

## Commit Intent

```text
chore: retire the GitHub Pages deployment
```

## Outcome

One deployment remains. The Pages workflow, its path-prefix plumbing, and the
guidance describing it are gone.
