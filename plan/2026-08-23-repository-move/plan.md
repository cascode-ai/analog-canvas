---
status: completed
experience: none
---

# Follow the repository to its new home

## Goal

Point the checkout and the product's own links at
`cascode-ai/analog-canvas`, so neither depends on GitHub's rename redirect.

## What the move did and did not require

No re-clone. GitHub redirects the old path, which is why pushes kept working
while printing "This repository moved". Updating the remote URL is enough, and
because a worktree shares its git directory, one update covers the primary
checkout too.

What does need changing is every place the old URL is written down: a redirect
is a courtesy, not an address to publish.

## Work

1. `git remote set-url origin https://github.com/cascode-ai/analog-canvas.git`
   (configuration, not a tracked change).
2. Update the repository link the editor shows in Help, its two tests, and the
   GitHub Pages URL in the getting-started guide.

## Validation

- `git fetch` succeeds with no redirect notice; `gh repo view` resolves to
  `cascode-ai/analog-canvas`; push access confirmed with `--dry-run`
- `tsc -p tsconfig.check.json`, Prettier, markdown link check
- Component tests (14) and `chrome-isolation.spec.ts` (3) pass

## Gate Review

- Decision: affected
- Early gates: typecheck, Prettier, markdown links
- Affected gates: the component tests and the Playwright spec that assert the
  repository link
- Final gates: remote GitHub Actions
- Platform risks: none; no behavior changes.

## Test Impact

- Decision: tests-updated
- Contracts: the repository URL the product publishes.
- Primary checks: `apps/editor/src/components/editor-help-dialog.test.tsx`,
  `apps/editor/e2e/chrome-isolation.spec.ts`

## Commit Intent

```text
chore: follow the repository move to cascode-ai/analog-canvas
```

## Outcome

The editor links to the new repository and the guide names the new Pages URL.
