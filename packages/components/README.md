# Component Library — One Component, One File

The core authoring model has two levels:

1. **Component definitions** in `definitions/<symbol-id>.json`: reusable symbol
   geometry and electrical rules, together in one canonical file.
2. **Canvas Documents** in `@icm/model`: Instances reference the stable symbol
   ID and own placement, actual parameter values and styling; Documents own
   Nets, Routes, Annotations and hierarchy. Project JSON does not embed another
   copy of the built-in component library.

每个元件只有一份完整定义文件。`symbol` 定义怎么画，`electrical` 定义电气规则；
画布中的 M1、M2 保存各自的位置、参数取值和连接，不属于元件库。

Start with [NMOS](definitions/nmos.json), [PMOS](definitions/pmos.json),
[Resistor](definitions/resistor.json), [Capacitor](definitions/capacitor.json),
or [Inductor](definitions/inductor.json). Extended DMOS, drawing-only blocks,
and named symbol variants with their own stable IDs follow the same rule.

## What a definition owns

| Field           | Responsibility                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `schemaVersion` | Component authoring envelope version, independent of Project schema                                                            |
| `symbol`        | Complete Symbol DSL: primitives, arrows, pins, anchors and variants                                                            |
| `electrical`    | Complete DeviceDescriptor: parameters/defaults, pin semantics, model/netlist policy; explicit `null` when no descriptor exists |
| `catalog`       | Library, review/visual authority, category, palette eligibility and generation provenance                                      |

`electrical: null` does not claim simulation support. Conversely, a non-null
descriptor with `targetPolicy: "none"` may provide naming/authoring semantics
without a netlist implementation (for example, compound magnetic symbols).

`catalog.json` lists IDs in established display/registration order and owns
library-wide identity and semantic primitives. It contains no duplicate device
definitions. Every definition must be indexed exactly once; every non-null
electrical definition must occur exactly once in `deviceOrder`.

## Editing and generation

Edit the appropriate section of the one component file. For reference-derived
geometry, update the existing family generator/evidence under the visual
contract, then run that generator. The component-library authoring adapter
lets those generators read and replace Symbol/catalog sections while preserving
electrical parameters. New IDs must first have a complete definition and index
entry; a geometry generator cannot silently create electrical semantics.

Run `pnpm components:generate`, then `pnpm components:check` and the tests
appropriate to the change. The check is part of the static delivery gate.
NDMOS/PDMOS are checked/regenerated against their declared base MOS through one
shared drift-region operation, not independently maintained copies of the MOS
construction rules. Other families keep their existing targeted generators.

Runtime adapters in `@icm/devices` and `@icm/symbols` are generated projections,
not additional authoring sources. Electrical consumers do not import artwork;
the canvas resolver consumes the symbol projection. This preserves package
boundaries and the persisted Instance protocol without a new runtime package.
Do not edit `components.generated.ts`, `expanded-components.generated.ts`,
`razavi-catalog.generated.ts` or the Agent catalog by hand. Symbol hashes cover
the deterministic standalone Symbol projection, not unrelated electrical edits.

## Razavi visual authority and product boundary

`fixtures/visual-reference/razavi-reference-v1/manifest.json` is the only
visual authority. A catalog entry may appear in the Razavi palette only when
it is both `reviewed` and has:

```json
"visualAuthority": { "kind": "razavi-reference-v1", "...": "..." }
```

The product set is exactly the reviewed, Reference-calibrated entries:

- `nmos`, `pmos`, and `ground`;
- `voltage-source`, `pulse-voltage-source`, `current-source`; the two-terminal
  Digital Clock composes the calibrated independent voltage-source body with
  the Figure 16.8 clock-pulse mark and owns its timing semantics separately;
- `resistor`, `capacitor`, `inductor-compact`, their adjustable siblings
  `variable-resistor`, `variable-capacitor`, and `variable-inductor` (the base
  body plus one diagonal adjustment arrow), `port`, and `port-filled`;
- `inductor`, the evidence-exact Large Inductor. The textbook figure is drawn
  at its own scale, so the calibrated coil spans 60 logical units against the
  40 every other reviewed passive uses. Both come from the same pinned PDF
  vector evidence: `inductor` reproduces it exactly and keeps the fidelity
  target, while `inductor-compact` applies one uniform `pinSpanScale` (2/3)
  recorded in its catalog `generation` block so a schematic mixing R, C, and L
  reads at one scale. Imported SPICE `L` elements take `inductor-compact`;
- `tcoil` and `xfmr`, atomic parent-canvas Symbols composed from that same
  `inductor-compact` path. T-coil additionally reuses the reviewed Capacitor
  plates and leads. PDF-native evidence governs winding placement, bridge
  topology, and polarity-dot clearance; neither Symbol draws a circle at an
  external pin. Both remain manual-only until compound L/K/C or subcircuit
  lowering has an explicit contract. Placement still authors complete starting
  parameters: T-coil uses `L1=1n`, `L2=1n`, `K=1`, and `CB=1p`; XFMR uses
  `Lp=1n`, `Ls=1n`, and `K=1`;
- `diode` and `zener-diode`. The Zener body is direct PDF-vector evidence from
  _Fundamentals of Microelectronics_, Figure 3.44(a). Both retain the SPICE D
  electrical contract, but Zener presentation is manual or PDK-mapped because
  ordinary D syntax does not identify breakdown use;
- the behavioral block family `inverter`, `and-gate`, `or-gate`, `nand-gate`,
  `nor-gate`, `xor-gate`, `xnor-gate`, `buffer`, `delay-cell`,
  `d-flip-flop`, its active-high asynchronous-reset sibling
  `d-flip-flop-reset`, `comparator`, and its polarity-unmarked sibling
  `comparator-unmarked` (manual-only netlist mapping, like `opamp`). Inverter, AND,
  NAND, NOR, and XOR use hash-pinned native-vector evidence from textbook
  Figures 16.2, 16.24, and 16.25. Buffer and the generic D/CK/Q/Q-bar flip-flop
  use direct evidence from Figures 16.53(a) and 16.23(a). `delay-cell` uses the
  rectangular `Delta-T` stage from _Analysis and Design of Data Converters_,
  printed page 331, Figure 16.2(c); its timing and netlist implementation remain
  deliberately unmapped. OR is the reviewed NOR body without its output
  bubble; XNOR is the direct XOR body with the reviewed two-input NOR negation
  bubble.
- the Analog Blocks library includes the reference-calibrated single-input
  `transconductance` symbol and its user-requested house companion
  `differential-transconductance`. Both display `g_m` without a default unary
  plus; the differential form exposes `IN+`, `IN-`, and `OUT`.

`nmos` and `pmos` are the only MOS asset IDs in the Reference-calibrated
Razavi catalog. Their default visual variant is `textbook-3terminal`; explicit
bulk-capable variants remain properties of the same canonical assets. Optional
families such as high-voltage DMOS live in the separate Extended Devices
catalog and do not claim Razavi visual authority. The drawn VDD rail remains
the explicit Net/Route authoring form; `vdd-port` is its reviewed marker Symbol
for placed-device authoring on the same global VDD Net. There is no legacy
symbol catalog or generic fallback. A device without a reviewed Razavi symbol
or an explicit Extended Devices entry is an unsupported import error.

The catalog records only runtime electrical pin order and visual authority.
It does not read or cite VSS/Visio. Historic VSS material is archival evidence
outside this runtime contract and cannot determine geometry, typography, or
palette eligibility.

Each definition's `catalog` section is the source for its metadata.
`packages/symbols/src/razavi-catalog.generated.ts` is generated from these
definitions and the ordered index; do not edit that adapter manually.

Update and verify it with:

```powershell
pnpm symbols:razavi
pnpm symbols:razavi:check
```
