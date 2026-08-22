---
status: completed
experience: none
---

# Repeating a Cell Pin name places another marker

## Goal

Stop rejecting a Port whose name already exists. Drawing the same interface
pin at more than one place on a sheet is ordinary practice, so a repeated name
must place another marker for the terminal that already owns it.

## State and Ownership

Start state from `git status --short --branch`:

```text
## claude/duplicate-pin-names
```

Branched from `origin/main`. `.claude/` and `node_modules` are untracked local
scaffolding for this pnpm-less machine.

- `packages/edit-engine/src/hierarchy-planner.ts`
- `packages/edit-engine/src/hierarchy-planner.test.ts`
- `apps/editor/src/features/component-insert/use-component-placement.ts`
- `apps/editor/e2e/hierarchy.spec.ts`

- Shared: the formal Cell interface (`netlist.terminals`), which every parent
  Instance resolves its pins against.

## Work

1. Add `planAttachCellPortMarker`: place the Port Instance, append it to an
   existing terminal's `interfaceInstanceIds`, and merge the marker's Net into
   the terminal's Net. The model already types `interfaceInstanceIds` as a
   plural array, so no schema change is needed.
2. Route placement through it when the resolved formal name matches an
   existing terminal, replacing the `Cell port X already exists` abort.
3. Suppress the marker's own Net name and the `set_net_name` edit on that
   path — the terminal's Net already carries the name, and emitting it again
   would trip the duplicate-Net-name gate.

## Why a repeated name is not a second terminal

`connectivity-index.ts` and `schema/project.ts` resolve a parent Instance's
pin to a child terminal **by name**. Two terminals sharing a name would make
that lookup ambiguous and silently resolve to the first match, so the fix
keeps one terminal per name and lets a terminal own several drawn markers.

Renaming a terminal onto an existing name still rejects: unlike placement, it
is genuinely ambiguous between "these are one pin" and a typo, and folding two
formal terminals together would rewrite the interface every parent resolves
against. Its message now names the working alternative.

## Validation

- `git diff --check`
- `git status --short --branch`
- `vitest run packages/edit-engine apps/editor/src/features/component-insert`
  (221 passed), full unit suite (1162 passed)
- Playwright `hierarchy.spec.ts` (12 passed), including the new placement case
- `tsc -p tsconfig.check.json`

## Gate Review

- Decision: affected
- Early gates: typecheck, Prettier on changed files
- Affected gates: edit-engine and component-insert unit tests, the hierarchy
  Playwright spec that owns Cell Port placement
- Final gates: remote GitHub Actions on the PR
- Platform risks: none; no generated artifact, schema, or release path changed

## Test Impact

- Decision: tests-updated
- Contracts: a repeated formal name adds a marker to the existing terminal
  rather than a second terminal; the Cell interface stays one entry per name.
- Primary checks: `packages/edit-engine/src/hierarchy-planner.test.ts`,
  `apps/editor/e2e/hierarchy.spec.ts`

Both are new cases; the previous behavior was an abort with no coverage of
what happened after it.

## Commit Intent

Commit as:

```text
feat(edit-engine): place another marker for an existing Cell Pin name
```

## Outcome

Placing a Port whose name is already taken now succeeds and reports "Added
another marker for Cell port X". The formal interface still holds exactly one
terminal per name, so parent pin resolution is unchanged.
