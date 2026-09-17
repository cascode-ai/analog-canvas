# Agent documentation maintenance

This is maintainer-only guidance, not a circuit operating resource. See the
[consumer matrix](README.md) before adding a document or changing its audience.

## One edit and distribution loop

1. Edit a topic source or entry template here. Register document consumer,
   task, reading load, required dependencies and URI/Kit destination in
   `distribution.json`. Required dependencies must be delivered to every
   consumer of the requiring document; ordinary links may be cyclic.
2. Run `pnpm agent-docs:generate`. It reads source files directly, including the
   code-generated symbol catalog and request schema; no adapter build is needed.
3. Inspect `distribution.generated.json` for source/output SHA-256 and actual
   destinations. Run `node --test scripts/generate-agent-docs.test.mjs` and
   affected Kit, resources, CLI and connection-panel tests.
4. Run `pnpm agent-docs:check` (also in `ci:static`). This is read-only and fails
   on stale output. Commit source, registry and generated output together.

Markdown links become resource URIs or relative Kit paths. Every local link
in a runtime document must resolve inside that same distribution; missing
destinations fail generation instead of linking to a floating GitHub branch.
Repository-only helper internals stay in repository-only documents.
Runtime schemas and symbol facts
remain code-owned. Tool descriptions are in `mcp/tool-help.json`; HTTP operation
descriptions are in `http-kit/api-help.json` and generated into OpenAPI.
Argument schema descriptions stay with the schema. New tools must use registered help.

The browser template accepts only origin, serialized claim, manifest URL and
Kit URL placeholders. Replacement is a single callback pass, never evaluation.
Do not add tokens, private Project data, machine paths or example live claims.

## Migration decisions

| Old authority | Replacement | Reason |
| --- | --- | --- |
| `resource-manifest.json` and `codex-fallback` flags | `distribution.json` | Old flags did not actually distribute Kit/Skill |
| Kit prose embedded in adapter TypeScript | `http-kit/` and `shared/` | Runtime code is not a second prose source |
| MCP generator importing built Kit | Direct-source compiler | Remove build ordering and reversed ownership |
| Server instructions / tool help / browser message literals | `mcp/` and `entrypoints/` templates | Same review and generation boundary |
| Hand-maintained Skill and reference manifest | `repo-skill/` plus generated registry reading map | One task map, no copied operating policy |
| Developer preflight in circuit workflow | This maintainer guide | Operating Agents should not build the editor |
| Long MCP quickstart with CLI/version history | Short entry plus MCP tools/simulation and CLI guide | Load the right transport and task |
| Shared authoring's copied Specs/handoff paragraphs | Topic links and shared simulation workflow | Prevent independently changing result rules |
| Twelve knowledge files including an index and repeated policy | Five task cards, shared diagnostics and workflow | Keep evidence cues; remove repeated rituals and textbook introductions |
| RouteGraph internals in operating tools/recovery | Repository-only RouteGraph reference | Optional library is not a MCP tool or raw request form |
| Version history in MCP installation | Git/release record; current bootstrap manifest | Installed Agents need current setup, not old release chronology |

Content review also exposed ngspice-specific commands presented as generic
native-source instructions. Guides now distinguish Profile-selected VACASK
Python reporting from ngspice commands. The existing Spec extractor remains
SPICE-oriented; documentation must not promise unsupported native syntax or
acceptance-rule coverage. This change does not modify either executor/parser.

Old files are removed, not left as editable compatibility authorities. Existing
public resource URIs and Kit entry paths remain valid. A generated package is
immutable once released: local generation does not publish a package or update
installed MCP hosts. Delivery and package release require separate authorization.

## Preflight without command churn

For repository work, run commands from the repository root. Inspect state once
before building or starting another process:

```powershell
git status --short --branch
Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue
```

- Reuse a healthy existing editor at `http://localhost:5173/`; do not start a
  second dev server just to refresh the page.
- Use `pnpm dev` only when no editor server is listening.
- Build once after checkout or source changes.
- Prefer the focused package build/test named by the changed package. Run the
  workspace suite only when the change crosses shared contracts.
- Give builds and test runs a realistic timeout and read their final output;
  do not treat silence during a build as proof of a hang.

Common repository commands:

```powershell
pnpm build
pnpm test:local packages/agent-routing/test
pnpm --filter @icm/agent-routing build
pnpm typecheck
```
