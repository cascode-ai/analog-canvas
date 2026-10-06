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

Status: reference registration only. Workflow alignment has not been adopted.
These are original upstream sources, not the earlier rewritten `ac-*` skills.
Reading or fetching them does not install agent commands or make their procedures
repository rules. [AGENTS.md](../AGENTS.md), domain contracts, testing and delivery
policy continue to govern repository work. Earlier trial decisions and review
findings remain in [Issue #1358](https://github.com/cascode-ai/analog-canvas/issues/1358)
and Git history for the later alignment discussion.

The manifest pins Matt Pocock's skills at `4588b32`, HumanLayer's skills at
`ca7c808`, and unslop at `17ed39c`. All three are optional fetches. Follow the
original relative references and skill dependencies in each checkout; the full
upstream repositories retain their supporting files and license declarations.
Do not replace the originals with summaries or translate them into local rules
as part of this registration.

| Skill | Original source | Study purpose |
| --- | --- | --- |
| grill-with-docs | [Matt Pocock](https://github.com/mattpocock/skills/blob/4588b32ecab9ecc9fc8cc6b6c5e7d675b6004b0d/skills/engineering/grill-with-docs/SKILL.md) | Requirement interview and active domain modeling. |
| to-spec | [Matt Pocock](https://github.com/mattpocock/skills/blob/4588b32ecab9ecc9fc8cc6b6c5e7d675b6004b0d/skills/engineering/to-spec/SKILL.md) | Synthesize agreed requirements into a specification. |
| to-tickets | [Matt Pocock](https://github.com/mattpocock/skills/blob/4588b32ecab9ecc9fc8cc6b6c5e7d675b6004b0d/skills/engineering/to-tickets/SKILL.md) | Plan vertical slices and blocking dependencies. |
| implement | [Matt Pocock](https://github.com/mattpocock/skills/blob/4588b32ecab9ecc9fc8cc6b6c5e7d675b6004b0d/skills/engineering/implement/SKILL.md) | Implementation, testing, review and commit procedure. |
| code-review | [Matt Pocock](https://github.com/mattpocock/skills/blob/4588b32ecab9ecc9fc8cc6b6c5e7d675b6004b0d/skills/engineering/code-review/SKILL.md) | Independent Standards and Spec review. |
| pr | [Matt Pocock](https://github.com/mattpocock/skills/blob/4588b32ecab9ecc9fc8cc6b6c5e7d675b6004b0d/skills/engineering/pr/SKILL.md) | PR explanation, before/after evidence and merge impact. |
| show-me | [HumanLayer](https://github.com/humanlayer/skills/blob/ca7c8088db69e315a8b2deea43820270457f8f3c/plugins/show-me/skills/show-me/SKILL.md) | Visual explanation; also credited by Matt Pocock's pr skill. |
| improve-codebase-architecture | [Matt Pocock](https://github.com/mattpocock/skills/blob/4588b32ecab9ecc9fc8cc6b6c5e7d675b6004b0d/skills/engineering/improve-codebase-architecture/SKILL.md) | Survey architecture improvement opportunities. |
| retro | [Matt Pocock](https://github.com/mattpocock/skills/blob/4588b32ecab9ecc9fc8cc6b6c5e7d675b6004b0d/skills/engineering/retro/SKILL.md) | Reflect on a session and its development environment. |
| unslop | [theclaymethod](https://github.com/theclaymethod/unslop/blob/17ed39c9d0b522f44190ff0c6233867eadee192a/SKILL.md) | Audit or rewrite English prose while preserving meaning. |

Fetch the originals when needed:

```powershell
./scripts/fetch-references.ps1 -Name mattpocock-skills,humanlayer-skills,unslop
```

The checkouts are `.reference-src/mattpocock-skills/`,
`.reference-src/humanlayer-skills/` and `.reference-src/unslop/`. They remain
ignored and outside agent skill discovery directories. Inspect the skill and
its linked resources there when discussing an adaptation or explicitly choosing
to use its method. Registration does not add a setup step, CI gate or dependency.
