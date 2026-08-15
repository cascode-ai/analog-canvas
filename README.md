# Analog Canvas

Analog Canvas is a local-first, connectivity-aware schematic editor. Import
structural SPICE, edit a typed circuit model in the browser, save one portable
Project file, and export formal drawings.

## Start here

- **Use the editor:** [Getting started](docs/user/getting-started.md),
  [compatibility](docs/user/project-compatibility.md), and
  [troubleshooting](docs/user/troubleshooting.md).
- **Understand the product:** [current architecture](docs/overall-product-plan.md)
  and [documentation map](docs/README.md).
- **Develop or contribute:** [working rules](AGENTS.md),
  [current development reading set](docs/current/README.md), and
  [validation commands](#validation).

## Run locally

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Open the displayed loopback URL. Create a circuit from the component palette,
or import one `.cir`, `.sp`, or `.spi` entry together with its local include
files. Use **File / Save Project** to download the authoritative
`.icproj.json` file; browser recovery is only a non-authoritative safety copy.

## What the repository contains

- `apps/editor/`: React/SVG editor.
- `apps/local-host/`: loopback-only production host for the installable PWA.
- `packages/model/` and `packages/edit-engine/`: persisted circuit model and
  atomic mutation boundary.
- `packages/spice/`, `packages/symbols/`, and `packages/netlist/`: structural
  SPICE import, symbol semantics, and deterministic design-netlist export.
- `packages/exporters/` and `packages/render-svg/`: formal SVG, PNG, and PDF
  output.
- `docs/`: current architecture, user guides, normative contracts, ADRs, and
  explicitly non-authoritative historical records.

The [Razavi reference manifest](fixtures/visual-reference/razavi-reference-v1/)
is the sole visual authority. Retired Visio/VSS assets are historical evidence,
not product inputs; see [ADR 0011](docs/adr/0011-retire-visio-vss-as-visual-authority.md).

## Validation

```powershell
# Focused implementation loop
pnpm test:local <test-paths>
pnpm test:e2e:local <spec-paths> --grep <pattern>

# Branch integration
pnpm verify:branch

# Required local gate before a non-document delivery reaches main
pnpm ci:check
```

Use the smallest relevant check during development. Every target also closes
with `git diff --check` and `git status --short --branch`; see
[AGENTS.md](AGENTS.md) for the delivery gate.

## Citation

If you use Analog Canvas in research, teaching, or another publication, cite:

> Zengchun Chen and Zhishuai Zhang. _Analog Canvas_. 2026.
> Available at: https://github.com/chenzc24/Analog-Canvas

```bibtex
@software{chen2026analogcanvas,
  author = {Chen, Zengchun and Zhang, Zhishuai},
  title = {Analog Canvas},
  year = {2026},
  url = {https://github.com/chenzc24/Analog-Canvas},
  note = {Software repository}
}
```
