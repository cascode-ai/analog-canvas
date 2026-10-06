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

Status: selected original skills installed for branch trials; effectiveness and
workflow alignment remain pending. The checked-in [.agents/skills/](../.agents/skills/)
contains the 9 workflow entries below and 6 required dependency/setup skills:
15 skills with their original names, invocation policies, and complete supporting
files. Unrelated skills are not installed. The full upstream repositories remain
available in the ignored reference checkouts.

The earlier rewritten `ac-*` skills have been removed. Installation precedes
evaluation: test the original methods, compare their outcomes and cost, then
decide whether a skill, a local rule, or both should change. Do not silently
shorten an upstream procedure to make it fit existing policy. Actual repository
operations still follow [AGENTS.md](../AGENTS.md) and the user's trial scope;
conflicts are inputs to the alignment discussion rather than evidence that the
old workflow is better. Earlier decisions and review findings remain in
[Issue #1358](https://github.com/cascode-ai/analog-canvas/issues/1358) and Git history.

[Issue #1378](https://github.com/cascode-ai/analog-canvas/issues/1378) describes
mainline changes already drawn from these sources: the PR template, hard-defect
diagnosis, stricter changed-test validation, and queueing against the pushed
commit. It also explains lean testing and tests against the real editor.
Alignment should compare the originals with that current baseline, not create a
second delivery or testing process. The earlier `ac-pr` mentioned there has
been withdrawn. The original `pr` format differs from the mainline template,
and `implement` asks for a full final test run where mainline relies on the merge
queue; both differences remain explicit evaluation questions. This installation
does not add another diagnosis skill, CI check, or PR format requirement.

The manifest pins Matt Pocock's skills at `4588b32` and HumanLayer's skills at
`ca7c808`. Both are optional fetches. Follow the original relative references
and skill dependencies. The installation retains every file in each selected
skill folder. Matt Pocock's
[MIT notice](licenses/mattpocock-skills-LICENSE) and HumanLayer's
[MIT notice](licenses/humanlayer-skills-LICENSE) are retained here.

Unslop was removed from the installed trial and reference registration: prose
editing is outside the current development workflow evaluation. Its previous
installation remains in Git history.

Codex uses the project-local `.agents/skills/`. For Claude Code, create one local
link to the same directory from the repository root, once per checkout. If
`.claude/skills` already exists, inspect it first and preserve any local skills.

Windows PowerShell:

```powershell
New-Item -ItemType Junction -Path .claude/skills -Target (Resolve-Path .agents/skills).Path
```

macOS / Linux:

```sh
mkdir -p .claude
ln -s ../.agents/skills .claude/skills
```

The local link is ignored by Git. There is one source copy, no global install,
and no automatic upstream updates. Start a session in this trial checkout to
load the skills; installation does not prove that their methods are effective.
See [Codex skill locations](https://learn.chatgpt.com/docs/build-skills#where-to-save-skills)
and [Claude project skills](https://code.claude.com/docs/en/skills#where-skills-live).

Before the first engineering flow, use the original
[`setup-matt-pocock-skills`](../.agents/skills/setup-matt-pocock-skills/SKILL.md).
It asks for repository configuration and confirmation before writing it.
GitHub Issues is already the user's chosen tracker; domain documentation layout
remains to be discussed. Setup has not been run as part of installation. The
subset excludes `triage`, so setup skips its label configuration; `to-spec` and
`to-tickets` still expect a label vocabulary. This needs resolving in the setup
discussion before publishing specifications or tickets, without changing the
original files. The upstream
[`ask-matt`](https://github.com/mattpocock/skills/blob/4588b32ecab9ecc9fc8cc6b6c5e7d675b6004b0d/skills/engineering/ask-matt/SKILL.md)
explains how the skills compose and remains a reference rather than an installed
entry.

| Skill                         | Original source                                                                                                                                             | Study purpose                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| grill-with-docs               | [Matt Pocock](https://github.com/mattpocock/skills/blob/4588b32ecab9ecc9fc8cc6b6c5e7d675b6004b0d/skills/engineering/grill-with-docs/SKILL.md)               | Requirement interview and active domain modeling.            |
| to-spec                       | [Matt Pocock](https://github.com/mattpocock/skills/blob/4588b32ecab9ecc9fc8cc6b6c5e7d675b6004b0d/skills/engineering/to-spec/SKILL.md)                       | Synthesize agreed requirements into a specification.         |
| to-tickets                    | [Matt Pocock](https://github.com/mattpocock/skills/blob/4588b32ecab9ecc9fc8cc6b6c5e7d675b6004b0d/skills/engineering/to-tickets/SKILL.md)                    | Plan vertical slices and blocking dependencies.              |
| implement                     | [Matt Pocock](https://github.com/mattpocock/skills/blob/4588b32ecab9ecc9fc8cc6b6c5e7d675b6004b0d/skills/engineering/implement/SKILL.md)                     | Implementation, testing, review and commit procedure.        |
| code-review                   | [Matt Pocock](https://github.com/mattpocock/skills/blob/4588b32ecab9ecc9fc8cc6b6c5e7d675b6004b0d/skills/engineering/code-review/SKILL.md)                   | Independent Standards and Spec review.                       |
| pr                            | [Matt Pocock](https://github.com/mattpocock/skills/blob/4588b32ecab9ecc9fc8cc6b6c5e7d675b6004b0d/skills/engineering/pr/SKILL.md)                            | PR explanation, before/after evidence and merge impact.      |
| show-me                       | [HumanLayer](https://github.com/humanlayer/skills/blob/ca7c8088db69e315a8b2deea43820270457f8f3c/plugins/show-me/skills/show-me/SKILL.md)                    | Visual explanation; also credited by Matt Pocock's pr skill. |
| improve-codebase-architecture | [Matt Pocock](https://github.com/mattpocock/skills/blob/4588b32ecab9ecc9fc8cc6b6c5e7d675b6004b0d/skills/engineering/improve-codebase-architecture/SKILL.md) | Survey architecture improvement opportunities.               |
| retro                         | [Matt Pocock](https://github.com/mattpocock/skills/blob/4588b32ecab9ecc9fc8cc6b6c5e7d675b6004b0d/skills/engineering/retro/SKILL.md)                         | Reflect on a session and its development environment.        |

Dependencies are installed because the selected originals call them directly:

| Dependency                                                                      | Required by                                                       |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [grilling](../.agents/skills/grilling/SKILL.md)                                 | `grill-with-docs`, `improve-codebase-architecture`                |
| [domain-modeling](../.agents/skills/domain-modeling/SKILL.md)                   | `grill-with-docs`, `improve-codebase-architecture`                |
| [tdd](../.agents/skills/tdd/SKILL.md)                                           | `implement`                                                       |
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
