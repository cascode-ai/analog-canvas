---
status: completed
experience: none
---

# The circuit name is editable where it is read

## Goal

Let the circuit be renamed from the canvas, and keep one name behind the
header, the publish dialog, and the saved file.

## What was already true

Publishing (`defaultName={project.name}`), export
(`safeExportBaseName(project.name)`), and the saved file
(`projectFileBaseName`) all already derive from the Project's name. The only
missing half was being able to change it: the header rendered `New Circuit`
as static text.

## Work

1. Add a `rename_project` structure edit so the name changes through the same
   transaction path as everything else, rather than by rewriting the Project
   object and discarding its history. It counts as a structural change, or
   the transaction would report that it made none.
2. Render the name as a borderless field in the header: Enter commits, Escape
   reverts, blur commits.

## Also verified, not changed

Two reported defects did not reproduce and are recorded rather than "fixed":

- A deleted label **can** be restored from its Display checkbox, for both an
  instance reference and a Port label. `referenceLabelVisibilityEdits` already
  recreates a missing label when the box is ticked; probed both cases from
  delete through restore.

## Validation

- Full unit suite (1191 passed), full Playwright suite (211 passed)
- New Playwright case renames the circuit and asserts the saved Project file
  carries the new name
- `node scripts/visual-golden.mjs --check` clean
- `tsc -p tsconfig.check.json`, Prettier, `git diff --check`

## Gate Review

- Decision: affected
- Early gates: typecheck, Prettier
- Affected gates: edit-engine project-transaction tests, the project-file and
  gallery Playwright specs
- Final gates: golden check, remote GitHub Actions
- Platform risks: this adds a Project-structure edit kind, so the schema and
  its transaction path were exercised rather than assumed.

## Test Impact

- Decision: tests-updated
- Contracts: the Project rename edit, and that one name drives publish and the
  saved file.
- Primary checks: `apps/editor/e2e/project-file.spec.ts`,
  `apps/editor/e2e/gallery.spec.ts`

One gallery case read the circuit name from the header's text. The name is a
field now, so it reads the value instead.

## Commit Intent

```text
feat(editor): rename the circuit from the canvas
```

## Outcome

The header carries an editable circuit name, and the saved file follows it.
