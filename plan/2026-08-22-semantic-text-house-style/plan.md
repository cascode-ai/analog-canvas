---
status: completed
experience: none
---

# Uniform annotation text house style

## Goal

Apply one authoring rule to every annotation label: the leading character is a
capitalized italic symbol, the remainder defaults to its subscript, subscripts
render upright, and supply designators (`DD`, `SS`, `CC`, `EE`, `BB`) are the
one italic-subscript exception.

## State and Ownership

Start state from `git status --short --branch`:

```text
## claude/semantic-text-subscripts
```

Worktree clean at branch creation; `.claude/` and `node_modules` are untracked
local scaffolding for this pnpm-less machine and are not owned by this target.

- `packages/model/src/semantic-text.ts`
- `packages/model/src/semantic-text.test.ts`
- `packages/render-svg/src/schematic-text.test.ts`

- Read-only: `packages/render-svg/src/rich-text.ts`,
  `packages/derived/src/annotation-text.ts`
- Shared: the RichText AST shape consumed by render-svg, exporters, and the
  Agent snapshot; visual and export goldens.

## Work

1. Split every authored identifier into a capitalized italic base plus a
   subscript remainder, replacing the previous `V*`/`I*`-only shorthand and
   the role-specific `default-instance` / `instance-label` regex.
2. Carry the supply exception in the document rather than the renderer: the
   renderer already draws scripts upright and honors a nested italic span as a
   deliberate override, so an italic supply subscript is expressed as
   `subscript > italic > bold`.
3. Keep a trailing polarity sign outside the subscript.
4. Guard prose: a value containing whitespace keeps its capitalized first
   letter and stays one run, so a drafting note is not swallowed into a single
   long subscript.

## Validation

- `git diff --check`
- `git status --short --branch`
- `node_modules/.bin/vitest run packages/model packages/render-svg`
- Full unit suite (`vitest run`): 182 files / 1155 tests passed — the rule
  crosses model, derived, render-svg, netlist, exporters, and the editor.
- `node scripts/visual-golden.mjs --check` and
  `node scripts/export-golden.mjs --check`: both clean. The goldens carry
  `Vin+` and `Vout`, which the old `V*`/`I*` rule already split the same way,
  so the new rule is a strict superset over covered fixtures.
- Full Playwright suite: 189 passed.
- `node_modules/.bin/tsc -p tsconfig.check.json`

Note on historical documents: bound annotations are pure projections
(`resolveAnnotationText` re-derives instance designators, Net names, and
Cell-terminal names through `semanticTextDocument` on read), so existing
Projects adopt the new style without a schema migration. Persisted
`formatOverride` content is a deliberate manual edit and is preserved by
design, not as a compatibility concession.

## Gate Review

- Decision: affected
- Early gates: `tsc -p tsconfig.check.json`, Prettier on changed files
- Affected gates: `packages/model`, `packages/render-svg` unit tests, then the
  full unit suite and both golden `--check` gates because text rendering feeds
  every downstream artifact
- Final gates: `ci:check` equivalent run locally (pnpm unavailable; each gate
  invoked directly), plus remote GitHub Actions on the PR
- Platform risks: none specific; no generated artifact or release path changed

## Test Impact

- Decision: tests-updated
- Contracts: `semanticTextDocument` and `defaultDraftTextDocument` output
  shape; upright-by-default script rendering with an italic supply exception.
- Primary checks: `packages/model/src/semantic-text.test.ts`,
  `packages/render-svg/src/schematic-text.test.ts`

Two existing expectations asserted the superseded behavior and were rewritten
rather than removed: the non-voltage `CLK`/`NET1` case now asserts the
symbol/subscript split, and the `VDD` typography case now asserts the italic
supply subscript alongside a new upright ordinary-subscript case.

## Commit Intent

Commit as:

```text
feat(model): one annotation text house style with italic supply subscripts
```

## Outcome

`semanticTextDocument` and `defaultDraftTextDocument` now share one rule
instead of diverging per label role. Supply subscripts stay italic through a
nested italic span, which the renderer already treated as an intentional
override, so no renderer change was needed. Historical documents pick the
style up through the existing derived-projection path. Validation as recorded
above: 1155 unit tests, 189 e2e specs, both golden gates clean, typecheck
clean.
