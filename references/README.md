# Reference Sources

Reference repositories are pinned research and workflow study inputs, not
product dependencies.
They are fetched into the ignored `.reference-src/` directory and must never
be imported, bundled, or required by CI or a product build.

`manifest.json` records repository identity, immutable commit, declared
license, usage classification, default-fetch selection, allowed study scope,
and explicitly excluded scope.

The previous `net-painting-converter` repository has a deliberately narrow
role. Only its SPICE source handling, parsing, diagnostics, and fixtures may be
considered. Its automatic layout, routing, Page Scene, rendering, publishing,
and repository workflow are not architectural inputs to this product.

Fetch the default references:

```powershell
./scripts/fetch-references.ps1
```

Fetch one optional reference:

```powershell
./scripts/fetch-references.ps1 -Name spice-ts
```

The script refuses to rewrite an existing checkout whose origin or checked-out
commit differs. Resolve such state manually; reference fetching must not hide
local work or silently move a pin.

## Development skill references

Status: the [unified workflow](../docs/development-workflow.md) rules and
selected original skills are checked in for repository use. Both clients use
one source copy; Claude Code needs the checkout-local registration described
below. The rollout decisions and earlier trial evidence are recorded in #1358.
The checked-in [.agents/skills/](../.agents/skills/)
contains the 13 workflow entries below and 6 required dependency/setup skills:
19 skills with their original names, invocation policies, and complete supporting
files. Unrelated skills are not installed. The full upstream repositories remain
available in the ignored reference checkouts.

The earlier rewritten `ac-*` skills have been removed. Installation precedes
evaluation: test the original methods, compare their outcomes and cost, then
decide whether a skill, a local rule, or both should change. Do not silently
shorten an upstream procedure to make it fit existing policy. The new
[Agent entry](../AGENTS.md) and workflow replace the former management process.
The user has authorized mainline adoption. Earlier decisions and review findings remain in
[Issue #1358](https://github.com/cascode-ai/analog-canvas/issues/1358) and Git history.

[Issue #1378](https://github.com/cascode-ai/analog-canvas/issues/1378) describes
mainline changes already drawn from these sources: the PR template, hard-defect
diagnosis, stricter changed-test validation, and queueing against the pushed
commit. It also explains lean testing and tests against the real editor.
The new process reuses those tool checks and real-counterpart tests. It adopts
original pr's three columns, the complete pinned diagnosis reference and a
deliberate final local full-suite trial. These replace the former format and
validation-timing rules; required queue jobs remain. The earlier `ac-pr`
mentioned there has been withdrawn. No diagnosis entry or CI job is added.

The manifest pins Matt Pocock's skills at `49dd158` and HumanLayer's skills at
`ca7c808`. Both are optional fetches. Follow the original relative references
and skill dependencies. The installation retains every file in each selected
skill folder. Matt Pocock's
[MIT notice](licenses/mattpocock-skills-LICENSE) and HumanLayer's
[MIT notice](licenses/humanlayer-skills-LICENSE) are retained here.

Unslop was removed from the installed trial and reference registration: prose
editing is outside the current development workflow evaluation. Its previous
installation remains in Git history.

Codex uses the project-local `.agents/skills/`. Claude Code reads the same
originals through `.claude/skills/`; `CLAUDE.md` imports `AGENTS.md` explicitly.
From the repository root, register the skills once per checkout, including each
new worktree:

```sh
pnpm setup:skills
```

This command needs only Node.js; before installing workspace dependencies, the
equivalent command is `node scripts/setup-agent-skills.mjs`. It links complete
Skill folders using Windows junctions or relative directory symlinks on
macOS/Linux. Rerunning it adds missing registrations and accepts existing links
to this checkout, including the former whole-directory link. Unrelated custom
skills stay in place.

When a project Skill's name already belongs to local content, a link points
elsewhere or a registration path is not a directory, setup fails before adding
links and reports the conflicting path. Inspect it, move your custom Skill to
another name or deliberately correct its link target, then rerun. Existing
content is preserved; setup never replaces it.

Check registration without writing:

```sh
pnpm setup:skills -- --check
```

Start Claude Code in this checkout after setup. Invoke `/<skill-name>` using the
[workflow stage entries](../docs/development-workflow.md). Original invocation
policies and dependency calls are retained. If a command is absent,
check this checkout's registration and restart the session; check for a
same-name personal Skill shadowing the project version.

The local links are ignored by Git. A clone or new worktree needs its own setup,
with one source copy, no global install and no automatic upstream updates.
Registration does not prove that the methods are effective.
See [Codex skill locations](https://learn.chatgpt.com/docs/build-skills#where-to-save-skills)
and [Claude project skills](https://code.claude.com/docs/en/skills#where-skills-live).

Controlled native probes on this checkout resolved `pr` in both clients and
loaded `grill-with-docs` plus both original dependencies. Claude's session
catalog listed all 15 project entries and its `Skill` tool invoked `pr`,
`grilling`, and `domain-modeling`. Codex loaded the original dependency files
through its local skill mechanism; this is not evidence of a Claude-style
`Skill` tool call. The probes produced drafts and a first question round,
not a completed interview, published Spec, implementation, or delivery.
These earlier probes establish loading only. They do not certify every stage or
every client's publication and delegation behavior. Historical evidence is
recorded in [Issue #1358](https://github.com/cascode-ai/analog-canvas/issues/1358);
subsequent work records its own validation with the corresponding change.

The original
[`setup-matt-pocock-skills`](../.agents/skills/setup-matt-pocock-skills/SKILL.md)
has been applied using the user-approved configuration:
[GitHub Issues and ready-for-agent](../docs/agents/issue-tracker.md), and
[single-context domain documents](../docs/agents/domain.md). No empty glossary
or historical ADR copies are created. Triage is absent; only the publication
label needed by to-spec/to-tickets is configured. Configuration can be edited
directly; rerun setup when switching tracker or layout. The upstream
[`ask-matt`](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/engineering/ask-matt/SKILL.md)
explains how the skills compose and remains a reference rather than an installed
entry.

| Skill                         | Original source                                                                                                                                             | Study purpose                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| grill-with-docs               | [Matt Pocock](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/engineering/grill-with-docs/SKILL.md)               | Requirement interview and active domain modeling.            |
| to-spec                       | [Matt Pocock](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/engineering/to-spec/SKILL.md)                       | Synthesize agreed requirements into a specification.         |
| to-tickets                    | [Matt Pocock](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/engineering/to-tickets/SKILL.md)                    | Plan vertical slices and blocking dependencies.              |
| implement                     | [Matt Pocock](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/engineering/implement/SKILL.md)                     | Implementation, testing, review and commit procedure.        |
| code-review                   | [Matt Pocock](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/engineering/code-review/SKILL.md)                   | Independent Standards and Spec review.                       |
| pr                            | [Matt Pocock](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/engineering/pr/SKILL.md)                            | PR explanation, before/after evidence and merge impact.      |
| show-me                       | [HumanLayer](https://github.com/humanlayer/skills/blob/ca7c8088db69e315a8b2deea43820270457f8f3c/plugins/show-me/skills/show-me/SKILL.md)                    | Visual explanation; also credited by Matt Pocock's pr skill. |
| improve-codebase-architecture | [Matt Pocock](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/engineering/improve-codebase-architecture/SKILL.md) | Survey architecture improvement opportunities.               |
| retro                         | [Matt Pocock](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/engineering/retro/SKILL.md)                         | Reflect on a session and its development environment.        |
| implement-spec                | [Matt Pocock](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/engineering/implement-spec/SKILL.md)                | Dispatch a Spec's ticket frontier to parallel implementers.  |
| prototype                     | [Matt Pocock](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/engineering/prototype/SKILL.md)                     | Throwaway logic or UI prototype that answers one question.   |
| wizard                        | [Matt Pocock](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/engineering/wizard/SKILL.md)                        | Interactive script for steps only a person can perform.      |
| handoff                       | [Matt Pocock](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/productivity/handoff/SKILL.md)                      | Compact a session into a handoff for a fresh agent.          |

Dependencies are installed because the selected originals call them directly:

| Dependency                                                                      | Required by                                                       |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [grilling](../.agents/skills/grilling/SKILL.md)                                 | `grill-with-docs`, `improve-codebase-architecture`                |
| [domain-modeling](../.agents/skills/domain-modeling/SKILL.md)                   | `grill-with-docs`, `improve-codebase-architecture`                |
| [tdd](../.agents/skills/tdd/SKILL.md)                                           | `implement`, `implement-spec`                                     |
| [codebase-design](../.agents/skills/codebase-design/SKILL.md)                   | `tdd`, `improve-codebase-architecture`                            |
| [writing-for-agents](../.agents/skills/writing-for-agents/SKILL.md)             | `retro`                                                           |
| [setup-matt-pocock-skills](../.agents/skills/setup-matt-pocock-skills/SKILL.md) | Tracker and domain configuration expected by the engineering flow |

Fetch the originals when needed:

```powershell
./scripts/fetch-references.ps1 -Name mattpocock-skills,humanlayer-skills
```

The source checkouts are `.reference-src/mattpocock-skills/` and
`.reference-src/humanlayer-skills/`. They remain
ignored and separate from the checked-in installation. Fetching a reference
does not install, invoke, or update any skills. Future updates or adaptations
need an explicit source version and a reviewable diff; preserve the originals
until the comparison supports changing them.
