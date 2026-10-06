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
- Change circuit assets or models: packages/components/README.md and the
  circuit/model validation section in docs/testing/README.md.

## Complete the requested scope

Record intent, validation, test impact and known limitations with the change.
Local implementation ends at the validated and reviewed commit; normal product
delivery ends after the required merge checks and deployed behavior pass.
Honor an explicit local-only or trial-branch scope. Resolve failed checks and
report remaining work; preserve unresolved review findings.
