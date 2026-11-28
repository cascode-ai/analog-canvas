# Plugins

Status: `proposed`

Primary owner: `scripts/package-mcp.mjs` (release assets), with
`scripts/mcp-release-interfaces.mjs` (`interfaces.json`)

A plugin runs outside Canvas and uses only published interfaces and released
Canvas artifacts. Plugins live in
[cascode-ai/analog-canvas-plugins](https://github.com/cascode-ai/analog-canvas-plugins),
which owns their manifests, builds, releases and weekly compatibility check
([#2686](https://github.com/cascode-ai/analog-canvas/issues/2686)). This spec
owns what Canvas publishes for them. Each interface keeps its own contract:
[Project file](project-file-format.md), [RNL](rnl-interchange.md) and the
[Agent API](agent-api.md).

## Rules

- Each Canvas MCP release `mcp-v<version>` publishes for plugins:
  - `analog-canvas-mcp-server-<version>.tgz`;
  - `analog-canvas-headless-<version>.mjs`;
  - `interfaces.json`;
  - `SHA256SUMS.txt`, which lists the three files above with their SHA-256.
- Release assets are immutable, so a new interface version reaches plugins
  only in a new MCP release.
- Packaging derives `interfaces.json` from the version constants in code. CI
  fails while the committed copy,
  [`apps/mcp-server/interfaces.json`](../../apps/mcp-server/interfaces.json),
  differs from them, so every interface change shows in review.

## Contract

`interfaces.json` is
`{ "schemaVersion": 1, "interfaces": { <key>: { "writes", "oldestRead" } } }`:
for each interface key, the version the release writes and the oldest version
it still reads. The committed copy holds the current values.

| Key            | Version                           | `writes`                         | `oldestRead`                                                                 |
| -------------- | --------------------------------- | -------------------------------- | ---------------------------------------------------------------------------- |
| `project-file` | Project `schemaVersion` (integer) | The schema every save writes     | The oldest schema an import upgrades                                         |
| `rnl`          | RNL language (`"major.minor"`)    | The language every export writes | The oldest language whose drawing is read; older circuits come in without it |
| `agent-api`    | `apiVersion` (`"major.minor"`)    | The version of every response    | The oldest request version accepted; others get the version diagnostic       |

- Version 1 keeps these keys and fields. A new interface adds a key, such as
  `eda-source` when that export ships.

## Acceptance criteria

- Changing an interface version in code without regenerating the committed
  copy fails the check
  ([test](../../scripts/mcp-release-interfaces.test.mjs)).
- The packaged release lists `interfaces.json` in `SHA256SUMS.txt`, and its
  local mode writes the Project schema and RNL language that
  `interfaces.json` names ([`mcp-release-smoke.mjs`](../../scripts/mcp-release-smoke.mjs)).
- Publish MCP uploads `interfaces.json` with the other assets
  ([test](../../scripts/mcp-release-workflow.test.mjs)).
