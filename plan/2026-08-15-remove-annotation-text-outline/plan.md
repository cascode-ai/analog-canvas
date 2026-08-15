---
status: completed
experience: none
---

# Remove annotation text-outline feedback

## Goal

Keep the existing annotation selection and editing behavior, while removing the
blue hover/selected outline drawn by the invisible text hit surface. Selection
state and the canvas marquee remain the sole visible selection feedback.

## State and Ownership

Start state from `git status --short --branch`:

```text
## codex/remove-annotation-text-outline...origin/main
```

The repository root is checked out on an unrelated `add-about-help-panel`
branch and contains an unrelated untracked `.worktrees/unified-move/`
directory. This target uses its own clean worktree from `origin/main` and does
not modify either item.

- `apps/editor/src/styles.css`
- `apps/editor/e2e/manual-editor.spec.ts`
- `plan/2026-08-15-remove-annotation-text-outline/plan.md`
- `plan/root-audit.md`
- `plan/log.md`

Read-only/shared dependencies: `VisualSelection`, annotation hit-testing, and
the formal SVG renderer. This target must not change their behavior or their
persisted contracts.

## Work

1. Override the generic hit-target hover/selected paint only for text
   annotation hit surfaces, leaving their pointer events and selection state
   intact.
2. Add a browser assertion that an explicitly selected instance annotation is
   still selectable but has no accent stroke or dash pattern.
3. Record the completed delivery and run focused editor validation.

## Validation

- `pnpm test:e2e:local apps/editor/e2e/manual-editor.spec.ts --grep <annotation feedback regression>`
- `pnpm format:check`
- `git diff --check`
- `git status --short --branch`

## Commit Intent

Commit as:

```text
fix(editor): remove annotation text outline feedback
```

## Outcome

Added a local CSS override after the generic hit-target hover rule. Annotation
text hit surfaces remain selectable, draggable, and editable, but their hover
and selected states now keep a transparent, undashed stroke. Focused browser
coverage verifies both the visual rule and the existing label selection, move,
and edit paths.
