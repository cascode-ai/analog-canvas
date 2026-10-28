# Agent documentation maintenance

Maintainer-only. Check the [consumer matrix](README.md) before adding a
document or changing its audience.

## Edit and distribute

1. Edit a source or entry template here. Register its consumers, task, load,
   required dependencies and URI/Kit destination in `distribution.json`.
   Required dependencies must reach every consumer of the requiring document;
   ordinary links may be cyclic.
2. Run `pnpm agent-docs:generate`. It reads sources directly, including the
   code-generated symbol catalog and request schema; no adapter build is needed.
3. Inspect `distribution.generated.json` for hashes and destinations. Run
   `pnpm test:local scripts/generate-agent-docs.test.mjs` and affected Kit,
   resources, CLI and connection-panel tests.
4. `pnpm agent-docs:check` (also in `ci:static`) fails on stale output without
   writing. Commit source, registry and generated output together.

Markdown links become resource URIs or relative Kit paths; every local link in
a runtime document must resolve inside its own distribution, or generation
fails. Repository-only helper internals stay in repository-only documents.
Runtime schemas and symbol facts stay code-owned. Tool descriptions live in
`mcp/tool-help.json` and HTTP operation descriptions in `http-kit/api-help.json`
(generated into OpenAPI; run `pnpm agent-api:artifacts`); argument schema
descriptions stay with the schema; new tools must use registered help. A tool
description is at most 900 characters (`apps/mcp-server/src/tools.test.ts`);
policy text and long workflows go in a reference it links.

The browser template accepts only origin, serialized claim, manifest URL and
Kit URL placeholders, replaced in one callback pass, never evaluated. Never add
tokens, private Project data, machine paths or example live claims.

Remove old files rather than keep compatibility copies, but keep existing
public resource URIs and Kit entry paths valid (alias registry entries may
share a source). A released package is immutable: local generation publishes
nothing and updates no installed host; delivery and release need separate
authorization.

## MCP package release

`config/agent-mcp-distribution.json` owns the immutable release identity.
`pnpm mcp:release:bump -- --version <version>` updates it and the workspace
package and clears the old digest, so distribution validation stays red until
a new digest is recorded:

- either build on Linux with the Node/npm pinned by `mcp-release.yml`, then
  `pnpm mcp:release:bump -- --stamp` and `pnpm mcp:distribution:check`;
- or dispatch **Publish MCP** on the candidate branch with `package_only=true`
  (builds, stamps and uploads the archive, `SHA256SUMS.txt` and
  `mcp-bootstrap-release.json` without publishing), download it
  (`gh run download <run> --dir <dir>`) and run
  `pnpm mcp:release:bump -- --from-ci-artifact <dir>/mcp-candidate-<sha>` on
  any platform once the tarball matches its sums.

Normal publication verifies the committed digest and never restamps. Publish
the GitHub Release before deploying a site that advertises it. Production
downloads the declared archive and verifies SHA-256 before changing the
serving Worker, then checks the live manifest matches the declaration; a
manifest HTTP 200 alone is not acceptance.
