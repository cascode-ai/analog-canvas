---
status: completed
experience: none
---

# Keep BJT Base Wires Solid

## Goal

Restrict the Razavi dashed-route presentation to MOS bulk (`B`) terminals.
BJT base (`B`) terminals must create ordinary solid editable wires.

## State and Ownership

Start state from `git status --short --branch`:

```text
## codex/bjt-base-solid-wire...origin/main
```

The worktree is clean. This target owns the shared MOS-bulk endpoint predicate,
editor wire-source selection, focused tests, and plan/log records.

- `packages/derived/src/mos-bulk.ts`
- `apps/editor/src/app/App.tsx`
- `packages/render-svg/src/render.ts`
- `packages/edit-engine/src/routing-planner.ts`
- `packages/edit-engine/src/transaction.ts`
- focused tests and `plan/`

Read-only shared contract: `bulk-dashed` is reserved for explicit MOS body
connections; route electrical connectivity itself is unchanged.

## Work

1. Define one semantic predicate for a MOS `B` terminal.
2. Use it for new Wire sources and for existing Route rendering/deletion so
   malformed legacy BJT records are safely interpreted as ordinary wires.
3. Prove BJT base endpoints remain normal wires while MOS bulk retains dashed
   presentation.

## Validation

- focused derived/editor tests
- `pnpm typecheck`
- `git diff --check`
- `git status --short --branch`

## Commit Intent

```text
fix(wiring): keep BJT base routes solid
```

## Outcome

Added device-aware MOS-bulk predicates and replaced name-only `B` checks at
the editor, renderer, route-tap, deletion, and bulk-default boundaries. New
BJT base wires and legacy BJT records marked `bulk-dashed` are now ordinary
solid wires; MOS bulk routes retain their dashed presentation. Focused derived,
Edit Engine, renderer, and browser coverage plus TypeScript validation passed.
