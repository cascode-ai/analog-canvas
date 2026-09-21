# Analog Canvas

Analog Canvas is a local-first, connectivity-aware schematic editor for the
web. Draw and organize hierarchical circuits, import structural SPICE, export
deterministic SPICE/Spectre netlists and vector SVG/PDF, publish selected work
to the Community Gallery, and connect authorized Agents through the same typed
edit model.

[Browse the Gallery](https://analog-canvas.tokenzhang.com/) ·
[Open the editor](https://analog-canvas.tokenzhang.com/editor) ·
[Documentation](docs/README.md) ·
[GitHub repository](https://github.com/cascode-ai/analog-canvas)

## Highlights

- **Connectivity-aware editing:** place devices, route wires, distinguish
  Crossings from Junctions, label Nets, and make undoable multi-object edits
  deriving physical networks from completed wire edits while keeping logical
  labels and unrouted import intent explicit.
- **Reusable hierarchy:** author each schematic as a Cell, define independent
  Cell Pins, place reusable hierarchical blocks, and navigate between callers
  and child Cells.
- **Projects and interchange:** save a private Cloud Project, import/export
  canonical `.icproj.json`, import structural `.cir`, `.sp`, `.spi`, and `.scs` files, and export
  deterministic structural SPICE or Spectre. The hosted editor also provides
  saved simulation source folders and a fixed ngspice/SKY130 environment for qualified
  OP, DC, AC, TRAN, and Noise runs.
- **Publication-ready output:** the web editor's SVG and PDF exports remain
  vector graphics; PNG is rendered at 3× raster scale.
- **Community publishing:** signed-in users can publish selected circuits with
  server-rendered previews, tags, likes, moderation, and bounded version
  history. Publishing is deliberate and is not a backup mechanism.
- **Agent integration:** the typed Snapshot and transaction API is available
  through a version-pinned stdio MCP adapter, an HTTP Agent Kit, and the
  published OpenAPI contract. See the [Agent integration guide](docs/agent/README.md).

## Project ownership and privacy

An explicit **File / Save** updates one private Cloud Project in place. Local
`.icproj.json` files are portable import/export and backup artifacts; browser
recovery is an origin-local crash-safety copy. Neither is confused with formal
Cloud Save, and Community Gallery entries remain separate public publications.
Shelf cards offer **Version history** for the latest three earlier saves: compare
component changes, restore with conflict protection, or create an independent
private branch. Restoring a draft never updates its Gallery publication.
Refreshing the editor restores that browser window’s open project tabs,
including unsaved circuit content, the active tab, and view positions. This
browser-local workspace does not replace Cloud Save or portable file backups;
undo stacks and unfinished text-field edits are not restored.
Hosted topology checks run against the clicked snapshot in a private background
task. Refreshing or closing the page does not cancel it; reopen the editor to
view progress/results. Results remain available for seven days. Comparisons
use bounded search and explicitly mark incomplete coverage; the best 20
results are retained within an 8 MiB result budget. Vite without the hosted
backend shows a local-only fallback that requires keeping its page open.
The hosted service keeps its visitor reporting first-party and honors browser
Do Not Track instead of embedding a third-party analytics tracker.

**Check and Save** runs ERC and visual checks on demand, displays findings in
Issues and the canvas, and saves through that same Cloud Project service.
Findings do not block saving; editing invalidates the last check without
automatically rerunning it. File / Save and Ctrl+S remain save-only.

## Start here

- **Use the hosted product:** browse the
  [Community Gallery](https://analog-canvas.tokenzhang.com/) or start a
  [new circuit](https://analog-canvas.tokenzhang.com/editor).
- **Learn the editor:** [Getting started](docs/user/getting-started.md),
  [schematic hierarchy](docs/user/schematic-hierarchy.md),
  [compatibility](docs/user/project-compatibility.md), and
  [troubleshooting](docs/user/troubleshooting.md).
- **Understand the product:** [current architecture](docs/overall-product-plan.md)
  and [documentation map](docs/README.md).
- **Develop or contribute:** [working rules](AGENTS.md),
  [current development reading set](docs/README.md#contributor-reading-order), and
  [test system](docs/testing/README.md).

## Run locally

Requires Node.js 24 or newer and pnpm 11.16.0 or newer.

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm dev
```

Run `pnpm build` once after installing, and again after pulling package
changes: the development server's Vite configuration loads some workspace
packages from their built `dist/` output.

Open the displayed loopback URL and choose **New Circuit**, or open its
`/editor` route directly. Create a circuit from the component palette, or
import one `.cir`, `.sp`, `.spi`, or `.scs` entry together with its local include
files.

Click **Agent** to open a connection message, then copy it into your Agent
chat. The development server starts the local Agent relay on first use;
no separate Worker command or cloud account is needed. Keep the editor open
while the Agent works. Sessions expire after 30 minutes without Agent operations
or manual edits; continued activity renews them. Stopping the development server
also ends local sessions;
after restarting it, create a new connection. Cloud account, Gallery, and
hosted simulation services are not started by this local relay.

Development follows two stages: iterate locally with focused checks and local
commits, then deliver a pull request whose merge deploys directly to
Production. See the
[working rules](AGENTS.md#development-and-delivery)
and [delivery cadence](docs/deployment.md#development-and-delivery-cadence).

## What the repository contains

- `apps/editor/`: React/SVG editor plus the Gallery, account, moderation, and
  project surfaces.
- `apps/editor/analytics/`: the complete first-party analytics module: page,
  styles, browser reporting, HTTP routes, map data, and Durable Object backend.
- `apps/local-host/`: loopback-only production host for the installable PWA.
- `apps/mcp-server/`: packaged stdio MCP adapter for authorized Agent sessions.
- `packages/model/`, `packages/project-protocol/`, and `packages/edit-engine/`:
  current persisted circuit model, bounded file compatibility, and atomic
  mutation boundary.
- `packages/derived/`: read-only connectivity, diagnostic, and geometry
  projections over the persisted model.
- [`packages/components/`](packages/components/README.md): one canonical JSON
  file per built-in component, containing its symbol, electrical rules and
  catalog metadata; runtime packages consume generated projections.
- `packages/spice/`, `packages/devices/`, `packages/symbols/`, and
  `packages/netlist/`: structural SPICE import, built-in device facts, symbol
  semantics, and deterministic design-netlist export.
- `packages/exporters/` and `packages/render-svg/`: formal SVG, PNG, and PDF
  output.
- `packages/math-typesetting/`: bounded LaTeX formula typesetting for rich-text
  annotations.
- `packages/simulation-service/` and `packages/spice-run/`: shared simulation
  preparation, run lifecycle, and artifacts, plus simulator request and result
  contracts.
- `packages/timing-simulation/`: deterministic digital timing simulation; its
  experimental editor UI is hidden in production builds.
- `packages/platform-node/`: Node filesystem storage and recovery adapters with
  no current in-repository consumer.
- `packages/agent-adapter/`, `packages/agent-client/`, and
  `packages/agent-routing/`: shared Agent contract, client, and routing logic.
- `worker/`: Cloudflare Worker host and Durable Objects for static hosting,
  Gallery, accounts, Cloud Projects, simulation, and Agent relay sessions.
- `containers/`: simulator images, gateways, and operator-host topologies for
  ngspice and the historically named VACASK candidate used by Production.
- `netlists/`: one circuit per directory for the SPICE import corpus,
  simulation examples and qualification, and Agent layout evaluation.
- `fixtures/`: Project, SPICE, rawfile, export, Agent API, and visual-reference
  test inputs and goldens.
- `scripts/` and `config/`: build, generation, validation-gate, release, and
  deployment tooling, with the gate catalog and pinned MCP and VACASK
  declarations.
- `tools/`, `skills/`, and `references/`: manual Razavi calibration and PDF
  extraction tools, the repository-local `circuit-layout` Agent Skill, and the
  pinned external research-source manifest.
- `docs/`: current architecture, user guides, normative contracts, ADRs, and
  delivery plans.

The [Razavi reference manifest](fixtures/visual-reference/razavi-reference-v1/)
is the sole visual authority. Every non-documentation merge to `main` deploys
to Production; release tags and explicit dispatches may redeploy a commit that
is already on `main`.
See [deployment](docs/deployment.md) for the release and recovery contract.

## Netlist conversion

`POST /api/netlist/convert` accepts `{ "text": "...", "source": "spice", "target": "spectre" }`
and returns translated text or line-specific diagnostics. The Worker and local
Vite server expose the same pure converter; SCS import uses it locally too.
No Python daemon, simulator or account is required. The structural subset adapts
[netlist-crawler](https://github.com/Arcadia-1/netlist-crawler) under its MIT license.
See the [conversion contract](docs/specs/netlist-conversion.md) for supported
syntax and the [attribution](packages/spice/third-party/netlist-crawler/README.md).

## License

Copyright © 2026 Zengchun Chen and Zhishuai Zhang.

Except where otherwise noted, Analog Canvas is licensed under the
[GNU Affero General Public License v3.0 only](LICENSE.md)
(`AGPL-3.0-only`). Modified versions that are distributed or made available
for remote network interaction must provide their Corresponding Source under
the same license. Third-party dependencies, reference material, and assets
retain their respective copyright and license terms.

## Citation

If you use Analog Canvas in research, teaching, or another publication, cite:

> Zengchun Chen and Zhishuai Zhang. _Analog Canvas_. 2026.
> Available at: https://analog-canvas.tokenzhang.com/
> Source code: https://github.com/cascode-ai/analog-canvas

```bibtex
@software{chen2026analogcanvas,
  author = {Chen, Zengchun and Zhang, Zhishuai},
  title = {Analog Canvas},
  year = {2026},
  url = {https://analog-canvas.tokenzhang.com/},
  note = {Source code: https://github.com/cascode-ai/analog-canvas}
}
```
