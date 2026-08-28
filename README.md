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
  without treating drawing geometry as electrical truth.
- **Reusable hierarchy:** author each schematic as a Cell, define independent
  Cell Pins, place reusable hierarchical blocks, and navigate between callers
  and child Cells.
- **Projects and interchange:** save a private Cloud Project, import/export
  canonical `.icproj.json`, import structural `.cir`, `.sp`, and `.spi` files, and export
  deterministic structural SPICE or Spectre. Analog Canvas does not supply
  simulation, PDKs, device models, corners, stimuli, or analyses.
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
The hosted service keeps its visitor reporting first-party and honors browser
Do Not Track instead of embedding a third-party analytics tracker.

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
  [current development reading set](docs/current/README.md), and
  [test system](docs/testing/README.md).

## Run locally

Requires Node.js 24 or newer and pnpm 11.16.0 or newer.

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Open the displayed loopback URL and choose **New Circuit**, or open its
`/editor` route directly. Create a circuit from the component palette, or
import one `.cir`, `.sp`, or `.spi` entry together with its local include
files.

## What the repository contains

- `apps/editor/`: React/SVG editor plus the Gallery, account, moderation, and
  analytics screens.
- `apps/local-host/`: loopback-only production host for the installable PWA.
- `apps/mcp-server/`: packaged stdio MCP adapter for authorized Agent sessions.
- `packages/model/`, `packages/project-protocol/`, and `packages/edit-engine/`:
  current persisted circuit model, bounded file compatibility, and atomic
  mutation boundary.
- `packages/spice/`, `packages/devices/`, `packages/symbols/`, and
  `packages/netlist/`: structural SPICE import, built-in device facts, symbol
  semantics, and deterministic design-netlist export.
- `packages/exporters/` and `packages/render-svg/`: formal SVG, PNG, and PDF
  output.
- `packages/agent-adapter/`, `packages/agent-client/`, and
  `packages/agent-routing/`: shared Agent contract, client, and routing logic.
- `worker/`: Cloudflare Worker and Durable Objects for static hosting, Gallery,
  accounts, first-party analytics, and Agent relay sessions.
- `docs/`: current architecture, user guides, normative contracts, ADRs, and
  delivery plans.

The [Razavi reference manifest](fixtures/visual-reference/razavi-reference-v1/)
is the sole visual authority. The production Worker is deployed from `main` by
the [Cloudflare workflow](.github/workflows/cloudflare.yml).

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
