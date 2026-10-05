---
name: ac-code-review
description: Review an Analog Canvas candidate independently for repository standards and originating requirements. Use for significant branch/PR changes or requested reviews, with fresh subagents and explicit repair dispositions.
license: MIT
metadata:
  upstream: mattpocock/skills
  revision: 4588b32ecab9ecc9fc8cc6b6c5e7d675b6004b0d
  source: skills/engineering/code-review/SKILL.md
---

# Review two axes

Read [the workflow](../../../docs/development-workflow.md). Establish the review
base from the user's request, target record or known mainline base. Resolve it,
pin its SHA and the candidate revision, and capture the exact diff and commit list.
For a committed branch use merge-base comparison. For work in progress include
committed, staged and unstaged changes plus all intended new files; git diff alone
does not include untracked files. Check for changes during review before accepting
the report. Empty or invalid ranges stop with a useful explanation.

Find requirements from the supplied Issue/spec or owning commit references. Read
the body and relevant decisions, then its linked contracts. If absent, ask for the
source when needed; a Standards-only review must report Spec as unverified. Collect
AGENTS.md, docs/README.md, the closer domain instructions and relevant design rules.

For a full review with requirements available, the coordinator spawns two parallel
subagents with no inherited conversation (for example fork_turns="none" when
supported). A requested single-axis review uses only that axis; unavailable
requirements leave Spec unverified while Standards can proceed. A delegated
reviewer performs its assigned axis directly, without spawning another pair.
Give each reviewer the exact candidate evidence and
necessary references; do not provide the implementer's rationale, suspected verdict
or the other agent's findings. Requirements and factual commit records are allowed.
The reviewer may inspect relevant dependencies. If clean isolation is unavailable,
use a separate human review or clearly state the independence limitation.

- Standards agent: cite documented violations and credible changed-code risks. Skip
  checks already enforced by tooling unless their result is missing or misleading.
  Treat unclear naming, duplication, feature envy, traveling field groups, primitive
  domain encodings, repeated dispatch, scattered ownership, mixed responsibilities,
  speculative abstractions, message chains, forwarding-only wrappers and incompatible
  inheritance as judgment calls, not automatic defects. Local documented rules win.
- Spec agent: cite the exact requirement and identify missing/partial behavior,
  wrong implementation and unrequested scope. Check failure behavior and evidence.
  Distinguish current accepted contracts from proposals and unresolved choices.

Each report should identify affected path/behavior, source rule or requirement,
severity and evidence, keeping suggestions separate from defects. Return Standards
and Spec separately and summarize findings within each axis; do not combine scores
or claim correctness from zero findings. Capture revision and reviewer provenance
in the owning commit or PR when closing the target.

Review alone reports findings. If repair is authorized, fix real defects within the
target, validate the changed behavior and obtain focused re-review. Record any
declined/deferred finding with its reason and owner; block completion when required
behavior or a mandatory check remains unresolved. Optional architectural work outside
scope is a separate target. No hidden rewrite, Issue closure or merge is authorized.
