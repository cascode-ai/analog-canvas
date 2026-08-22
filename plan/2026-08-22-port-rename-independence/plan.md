---
status: completed
experience: none
---

# Renaming one Net Port leaves its same-named twin alone

## Goal

Make renaming a Port a statement about that Port, not about every Port sharing
its name.

## The defect

Several Net Ports naming the same node share one Net — that is what a net
label means, and placing a second Port with an existing name merges into it.
Renaming then went through `planEnsureNamedNet`, which renames the shared Net,
so both Ports changed at once.

## Work

When the Port's Net carries another Net Port, the renamed Port leaves that
node instead: its pin is disconnected and reconnected to a Net of the new
name, joining an existing one when the name is already taken. Its bound label
is re-pointed at the new Net in the same transaction — otherwise the label
keeps reading the old name, which is exactly what the first attempt did.

A Port that is the only one on its Net still renames the Net in place, which
is the ordinary net-label behavior.

## Validation

- Full unit suite (1189 passed), full Playwright suite (209 passed)
- New Playwright case places two Ports named `Vshared`, renames one, and
  asserts the canvas carries both `Vshared` and `Vbias`
- `tsc -p tsconfig.check.json`, Prettier, `git diff --check`

## Gate Review

- Decision: affected
- Early gates: typecheck, Prettier
- Affected gates: the hierarchy Playwright spec that owns Port naming
- Final gates: remote GitHub Actions
- Platform risks: this edits connectivity, so the change is expressed as
  ordinary typed edits through the edit engine rather than by rewriting Net
  membership directly.

## Test Impact

- Decision: tests-updated
- Contracts: what renaming one Net Port does to the others.
- Primary checks: `apps/editor/e2e/hierarchy.spec.ts`

## Commit Intent

```text
fix(editor): rename one Net Port without renaming its twin
```

## Outcome

Renaming one of two `Vshared` Ports leaves the other reading `Vshared`.
