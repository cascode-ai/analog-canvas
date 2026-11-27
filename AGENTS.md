# Agent Entry

Read README.md and docs/development-workflow.md before starting work.
Use the selected original skills under .agents/skills/ and preserve their
invocation policies, human checkpoints, dependencies and review separation.

## Start a target

- Run git status --short --branch. Identify the owner, goal, owned paths,
  shared contracts and validation surface. Protect unrelated work; resolve
  overlapping or unclear ownership before editing.
- Use the current target branch or an isolated codex/ task branch. Keep
  unrelated targets in separate commits. Working notes belong in ignored plan/.
- Read the relevant domain instructions and accepted product contracts.
  Plan validation from expected paths, then revise it from the actual diff.

## Agent skills

- Issue tracker and publication labels: docs/agents/issue-tracker.md.
- Domain documentation: docs/agents/domain.md.
- Choose a stage and its required inputs: docs/development-workflow.md.
- Implement or validate behavior: docs/testing/README.md.
- Review changes: CODING_STANDARDS.md and the originating Spec.
- Deliver or recover Production: docs/deployment.md.
- Publish, update or curate live Gallery entries: use the Owner API token
  (`ANALOG_CANVAS_OWNER_TOKEN` or `~/.config/analog-canvas/owner-token`) via
  the HTTP API (`POST /api/gallery/submissions`, `PUT /api/gallery/<id>`,
  `PATCH /api/gallery/<id>/curation`, `POST /api/gallery/sources/<key>/entries`)
  directly; details in docs/specs/community-gallery.md#owner-editing.
- Change circuit assets or models: packages/components/README.md and the
  circuit/model validation section in docs/testing/README.md.

## Complete the requested scope

Record intent, validation, test impact and known limitations in the commit or
PR. Local implementation ends at the validated and reviewed commit; normal
product delivery ends after the required merge checks and deployed behavior
pass. Honor an explicit local-only or trial-branch scope. Resolve failed checks
and report remaining work; preserve unresolved review findings.

## Documentation

The single rule for repository docs; other documents point here.

- Change docs/ only when a contract changes (a rule, interface, limit,
  user-facing behavior or cross-repo agreement), an ADR records a decision, or
  a roadmap outcome or open question is added or resolved. Implementation notes,
  validation logs, measurements and history belong in the commit or PR.
- Write contracts as short rules in the shape of docs/specs/spec.template.md.
  Replace obsolete text in place; a change that adds doc text deletes what it
  makes obsolete.
- Follow .agents/skills/writing-for-agents/SKILL.md: current state only, each
  fact in one place with links elsewhere, rules over narrative, the
  environment over restated config or scripts.
