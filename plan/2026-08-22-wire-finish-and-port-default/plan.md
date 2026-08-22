---
status: completed
experience: none
---

# Double-click always finishes a wire, and a Net Port starts as Vin

## Goal

Make a double-click end wire drafting wherever it lands, and give a new Net
Port the conventional signal name instead of a bare ordinal.

## State and Ownership

Start state: branched from `origin/main` as `claude/port-defaults`.

- `apps/editor/src/app/App.tsx`
- `apps/editor/src/features/component-insert/use-component-placement.ts`
- `apps/editor/e2e/manual-editor.spec.ts`
- `apps/editor/e2e/hierarchy.spec.ts`

## The double-click defect

Reported: finishing a wire onto another wire kept drafting. Traced by logging
what the handler actually received:

```text
{"target":"circle","testid":"junction-junction-ui-7","hasSource":true,"steps":0}
```

Two causes compounding:

1. The canvas `onDoubleClick` only handled presses whose target was the
   background, so a double-click landing on a Junction or Route never reached
   the finishing path at all.
2. Landing on an endpoint or Route commits on the first press; the second
   press then opened a fresh wire at that same spot.

The fix handles the wire tool before the background-only guard, and ends the
session when a wire source has no authored step — which is what separates a
stray re-start from a real wire being finished there. A wire genuinely
finishing on empty space has already recorded a step on the first press, so it
still commits normally.

## Work

1. Hoist the wire branch of `onDoubleClick` above the background guard and end
   the session for a source with no authored step.
2. Name the first Net Port `Vin`, then `Vin2`, `Vin3`; the house text style
   renders it as a capital V with a lowercase `in` subscript.

## Validation

- `git diff --check`, `git status --short --branch`
- Full unit suite (1185 passed)
- Full Playwright suite (207): two failures were the intended rename, updated
  and re-run green
- `tsc -p tsconfig.check.json`

One existing hierarchy case renamed a Port to `VIN`, a case variant of the new
default, and Net names fold case-insensitively — so it silently kept `Vin`.
The case moved to `VBIAS`, which tests the same rich-label behavior without
colliding with the default.

## Gate Review

- Decision: affected
- Early gates: typecheck, Prettier
- Affected gates: editor unit tests, the wire and hierarchy Playwright specs
- Final gates: remote GitHub Actions
- Platform risks: none

## Test Impact

- Decision: tests-updated
- Contracts: a double-click never continues drafting; the default Net Port name.
- Primary checks: `apps/editor/e2e/manual-editor.spec.ts`,
  `apps/editor/e2e/hierarchy.spec.ts`

## Commit Intent

```text
fix(editor): finish the wire on any double-click and default a Port to Vin
```

## Outcome

Double-clicking onto an existing wire now reports "Wire finished" and leaves
nothing in progress. A new Net Port is named Vin.
