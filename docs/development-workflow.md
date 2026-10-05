# Development workflow

Status: branch trial. Owner: the change's human maintainer and target owner.

This guide is the shared entry for humans, Codex and Claude Code working on
Analog Canvas. The trial has three stages: introduce the rules and skills;
compare them with current repository practice; try human-selected product
targets. Shared requirements and trial findings live in
[trial Issue #1358](https://github.com/cascode-ai/analog-canvas/issues/1358).
Each selected product target uses its own GitHub Issue. A validated
trial branch is not a Production release. End branch-only trial scope explicitly
before following normal mainline delivery.

## Authority and reading

[AGENTS.md](../AGENTS.md) owns target boundaries, dirty-state ownership, commit
records and delivery discipline. [Documentation policy](README.md) owns where
contracts and rationale belong. [Testing](testing/README.md) and
[deployment](deployment.md) own validation and release. Read the target's
domain instructions and specs through the contributor reading order; no skill
redefines them. Surface conflicts instead of selecting whichever text is easier.

Read this guide once when joining a target. Load only the skill and references
needed for the current stage. Skills implement the procedure; contributors can
complete the same criteria manually or with another tool.

## Shared records and responsibilities

Use one GitHub Issue for a bounded target. Reuse an existing relevant Issue
instead of opening another. Its minimum content is the problem, observable
acceptance, scope, target owner and unresolved decisions. Technical work has an
owner too; tests, infrastructure, assets and documentation need no fictional
end-user story. A maintainer may also implement; significant behavior or shared
contract changes need an independent reviewer or review agent.

Keep feature requirements in the Issue. Link existing accepted contracts and
update their owning spec when the decision changes a lasting boundary. Decisions
that conflict with an accepted contract require a human decision and a deliberate
contract update or implementation repair. ADRs remain optional rationale.

For large work, link a parent Issue and create child Issues only for independently
verifiable slices. State actual blockers and owned boundaries; a change to shared
contracts can require an integration branch. Use existing labels when helpful;
Open/Closed plus explicit blockers and completion evidence suffice for this trial.
Do not create a second tracker in `plan/`, a new label taxonomy or a board merely
to run these skills.

Commits link the owning Issue with `Refs #<number>` and preserve intent, validation
and unresolved limitations. PRs summarize the final change and link those records.
Use a closing reference when the delivered change actually completes that Issue;
do not close it just because a local commit, push or draft PR exists. Keep current
scope, acceptance and blockers in the Issue; keep implementation and validation
history in commits/PRs rather than copying them into the Issue. Scratch notes and
temporary reports stay in ignored `plan/`; anything another collaborator needs to
continue must be accessible in the Issue, branch or owning commit.

## Stage completion criteria

| Stage | Ready to proceed when |
| --- | --- |
| Define | Requirement source, owner, scope, observable acceptance and consequential decisions are clear. Agent investigates discoverable facts; human resolves product choices. |
| Plan | Owned paths, shared dependencies, validation boundary and gate intent are known. Large targets have feasible slices and blockers; a small target needs no separate plan document. |
| Implement | The bounded behavior or document change is implemented and its selected checks pass, or specific environmental limitations are recorded. |
| Review and repair | Standards and requirements have both been checked; actionable findings are fixed or explicitly disposed of with evidence. Relevant checks and review are repeated after material repairs. |
| Commit and hand off | Intended files are reviewed and committed with the required record and Test-Impact declaration. The shared Issue points to the branch/commits and states remaining work. |
| Deliver | Normal mainline gates, required merge-queue results and Production verification complete. Branch-only trial targets stop at committed handoff until delivery is requested. |

A failed check, missing acceptance decision or unresolved blocking review finding
keeps its stage open. Existing incident and local-only exceptions in AGENTS.md
continue to apply. Record why a step was abbreviated; do not require a new file
or another confirmation when existing session decisions already settle it.

## Select depth by impact

| Target | Minimum additional evidence |
| --- | --- |
| Small fix | Reproduction or concrete before/after, expected behavior and focused verification; concise review of both axes. |
| New behavior or shared contract | Agreed acceptance and scope, relevant contract decisions, meaningful behavior tests and independent two-axis review. Split only when one bounded target cannot carry the work. |
| Documentation | Current topic authority, semantic review and relevant documentation checks; no obligatory TDD, interview or ADR. |
| Refactor | Preserved observable behavior and evidence covering affected callers; architectural suggestions beyond the target become separate work. |
| Circuit assets, generated files or simulation | Existing domain rules for source authority, caller pin order, regeneration, real-data census and electrical qualification where applicable. |
| Tooling, CI, deployment or workflow rules | Explicit execution impact, focused evidence and any fallback obligations selected by existing gate policy. |

The validation plan selects tests; skill use does not add an automatic full local
suite. Prefer the existing public test boundaries in the contract matrix. Reuse
agreed testing decisions; ask about a new boundary only when it changes coverage,
cost or the contract. Tests must distinguish the intended behavior from the defect.
AI review cannot replace electrical analyses, release checks or deterministic gates.

## Independent review

Pin the candidate revision and base before review. Review a working diff or a
committed range deliberately; include new files. Give an independent reviewer the
requirements, applicable standards, exact diff and relevant code references.

For significant changes use two fresh subagents: Standards and Spec. Supply
minimum raw evidence without inheriting the implementer's conversation or sending
its proposed verdict. If the runtime cannot isolate agents, use a separate human
review or explicitly record that independence is unverified. Never claim a clean
context merely because an agent has a different name.

Report each axis separately. Cite the requirement or rule and affected behavior;
distinguish defects, judgment calls and optional suggestions. A code smell is a
heuristic subject to local design rules. Missing requirements cannot be reported
as a Spec pass. Capture reviewer, revision, findings and dispositions in the owning
commit or PR; preserve raw reports locally when useful. Repairs require appropriate
checks and re-review of changed behavior, not automatic repetition of everything.
Architectural opportunities outside scope become separate Issues only when selected.

## Skill entry points

| Skill | Use |
| --- | --- |
| [ac-grill-with-docs](../.agents/skills/ac-grill-with-docs/SKILL.md) | Resolve consequential ambiguity and align domain language before implementation. |
| [ac-to-spec](../.agents/skills/ac-to-spec/SKILL.md) | Synthesize agreed requirements into the owning GitHub Issue. |
| [ac-code-review](../.agents/skills/ac-code-review/SKILL.md) | Review Standards and Spec independently, then repair and re-review. |
| [ac-pr](../.agents/skills/ac-pr/SKILL.md) | Draft or publish an authorized PR with evidence and merge-risk explanation. |

First use requires no global installation or setup skill: this guide configures
GitHub Issues and the existing documentation layout. Use a connected GitHub tool
or authenticated `gh` against the verified repository remote. Skills preserve
the user's authorization: a drafting/review request does not authorize publishing,
merging, contacting others or implementing another product feature.

Codex discovers the checked-in `.agents/skills/` folders. Mention `$ac-to-spec`
or ask to use the named skill. Claude Code uses the thin `.claude/skills/` entries,
for example `/ac-to-spec`; they instruct it to read the canonical source. Do not
edit those entries into a competing procedure. Other Agents can read SKILL.md by
path. Validate actual loading and behavior on each runtime being used; file-format
validation alone does not prove discovery or context isolation. Current loading
rules: [Codex](https://developers.openai.com/codex/skills) and
[Claude Code](https://code.claude.com/docs/en/skills).

The interview and domain-modeling primitives are embedded in ac-grill-with-docs;
it has no unresolved upstream Skill-tool calls. Manual slicing and implementation
use the criteria above. Dedicated to-tickets/implement skills can be added after
trial evidence justifies them. Architecture surveys, retro and English unslop
remain optional; invoke them for actual needs and keep their outputs in the owning
Issue/PR or local scratch. Future additions need their dependency closure checked.

## Keep the workflow small

Use an existing record before creating another. New rules must explain the real
failure they prevent and who checks them; mechanical requirements belong in the
cheapest existing tool. Add no permanent document, generic framework, new dependency
or mandatory approval merely because a template permits it. Treat scope expansion
as a deliberate decision. Human confirmation already present in the session remains
valid. Update current rules in place; Git owns history. Trial evaluation may remove
steps whose coordination and maintenance cost exceeds demonstrated benefit.

Review the trial after selected tasks: effective findings, missed requirements,
avoidable rework, human decision time, unnecessary confirmations and duplicate
records. Record concrete evidence in the trial Issue. No automatic recurring audit,
full-codebase rewrite, backlog migration or experience extraction is part of this
trial. Product targets must be selected before their implementation starts.

## Source and adaptation

The four entry skills adapt Matt Pocock's engineering skills at
[4588b32](https://github.com/mattpocock/skills/tree/4588b32ecab9ecc9fc8cc6b6c5e7d675b6004b0d).
ac-grill-with-docs incorporates the grilling and domain-modeling primitives;
ac-pr also draws on Dex Horthy/HumanLayer's
[show-me at ca7c808](https://github.com/humanlayer/skills/tree/ca7c8088db69e315a8b2deea43820270457f8f3c).
Retain the [Matt Pocock MIT notice](../.agents/skills/LICENSE-mattpocock.md) and
[HumanLayer MIT notice](../.agents/skills/LICENSE-humanlayer.md).

Local adaptations: GitHub Issues are configured here; existing topic specs own
contracts; `plan/` owns scratch; interview depth and testing reuse prior decisions;
no forced glossary, label set, extensive story list or local full suite; fresh
review context and complete candidate diffs are explicit; branch trial and delivery
are distinct. Preserve these choices when updating upstream versions. Skill names
are prefixed `ac-` to distinguish these project adaptations from personal skills.
