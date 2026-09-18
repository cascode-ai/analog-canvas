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
   destinations. Run `pnpm test:local scripts/generate-agent-docs.test.mjs` and
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

Old files are removed, not left as editable compatibility authorities. Existing
public resource URIs and Kit entry paths remain valid. A generated package is
immutable once released: local generation does not publish a package or update
installed MCP hosts. Delivery and package release require separate authorization.

## MCP package release

`config/agent-mcp-distribution.json` owns the immutable release identity.
Run `pnpm mcp:release:bump -- --version <version>` to update the declaration
and workspace package together. This clears the old digest deliberately;
normal distribution validation remains red until the new digest is recorded.

Build on Linux with the Node/npm version pinned by `mcp-release.yml`, then run
`pnpm mcp:release:bump -- --stamp` and `pnpm mcp:distribution:check`.
Alternatively, dispatch **Publish MCP** on the candidate branch with
`package_only=true`: it builds and stamps on Linux before validation and
uploads the archive, `SHA256SUMS.txt`, and `mcp-bootstrap-release.json`.
Record that candidate digest in the source declaration before delivery.
Candidate mode does not publish a release. Normal publication verifies the
committed digest and never restamps it.

Publish the immutable GitHub Release before deploying a site that advertises
it. Production downloads the complete declared archive and verifies SHA-256
before changing the serving Worker. After deployment it checks that the live
manifest matches the accepted declaration, without downloading the archive
again. A manifest HTTP 200 alone is not package acceptance.

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
