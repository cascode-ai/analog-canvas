<!--
Describe the change for the person reviewing it. The commit messages stay the
record, and the squash merge keeps them; this page shows the shape, the proof
and the risk. Keep the prose short and plain, and drop a section that has
nothing to say.

Adapted from humanlayer/skills (visual-pr, show-me) and mattpocock/skills
(pr), both MIT: https://github.com/humanlayer/skills and
https://github.com/mattpocock/skills
-->

## Why

<!-- One sentence, one per change in a batch: what was wrong or missing, and what works once this ships. -->

## Change outline

<!--
The smallest view that shows the change, each under a line saying what it
shows: a call tree, file tree, component tree or pseudocode as a `diff`
against the existing shape; a Mermaid diagram for a flow between parts; the
whole block when most of it is new. One or two views, not every kind.
-->

```diff

```

## Evidence

<!--
Before and after. A pair of screenshots for anything visible in the editor or
the Gallery, where they can be attached; otherwise the browser check that
shows it, with what it measured. For other changes, the test that fails
without the change and passes with it, or a command and its output. Redact
tokens and personal data.
-->

- **Before:**
- **After:**

## Merge risk

<!--
Door: two-way when reverting the merge undoes it, as with editor behavior;
one-way when it outlives a revert: a Project file format or migration, Gallery
or account data, the Agent API that published MCP clients call, an MCP
release, deleted data.
Blast radius: what breaks if this is wrong, and for whom.
-->

**Door:** two-way / one-way:
**Blast radius:**

## Notes

<!-- Up to three things a reviewer should not miss: a surprising decision, something left out on purpose, a follow-up. -->

## Validation

<!-- What ran locally (pnpm verify:pr, browser cases, the Gallery census) and what the merge queue runs. -->
