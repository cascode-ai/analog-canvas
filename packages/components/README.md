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
or [Inductor](definitions/inductor.json). Extended DMOS and depletion-MOS
variants, drawing-only blocks, and named symbol variants with their own stable
IDs follow the same rule.

## What a definition owns

| Field           | Responsibility                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion` | Component authoring envelope version, independent of Project schema                                                             |
| `symbol`        | Complete Symbol DSL: primitives, arrows, pins, anchors and variants                                                             |
| `electrical`    | Complete DeviceDescriptor: parameters/defaults, pin semantics, model/netlist policy; explicit `null` when no descriptor exists  |
| `subcircuit`    | Optional black-box subcircuit master for netlist export: target plus VDD/VSS and pin-mapped ports; only with `electrical: null` |
| `catalog`       | Library, review/visual authority, category, palette eligibility and generation provenance                                       |

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
NDMOS/PDMOS and depletion NMOS/PMOS are checked/regenerated against their
declared base MOS through one shared derivation operation, not independently
maintained copies of the MOS construction rules. Other families keep their
existing targeted generators.

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
- `port` and `port-filled` keep their calibrated circular bodies, with the
  right-hand lead and `P` terminal shortened by one 10-unit grid cell to x=0.
  Their view boxes shrink with that endpoint; the one-cell lead allowance
  stays an upper bound. These two directly authored definitions have no family
  generator. Reference evidence remains unchanged, and historical routes can
  be repaired manually if the moved terminal requires it;
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
- `ideal-switch`, `closed-switch`, and `externally-controlled-switch`. The
  three-terminal external-control form is direct Figure 16.38 (S1) vector
  evidence: `P`/`N` are the vertical switched path and `CTRL` is the single
  left-side logic input. It remains manual-only because primitive SPICE `S`
  requires a differential four-terminal control and cannot honestly encode
  this single-ended textbook abstraction;
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
  bubble. The eight combinational gates use the product normalization
  `bodyNormalization: "left-grid-anchor"`: translate the reviewed artwork
  horizontally so its leftmost outline lies at x=-20, preserving its scale,
  curves, bubbles and vertical coordinates. Buffer, Inverter, AND and NAND
  therefore place their vertical left edge on the grid, with exactly one-cell
  input leads from x=-30. OR/NOR and XOR/XNOR use their leftmost curve as the
  same baseline. Outputs extend from the body or bubble to the first 10-unit
  grid column that leaves at least 4 units of visible lead. Path bounds follow
  the artwork instead of the source crop's empty margin. The shared rule lives
  in `scripts/lib/anchor-logic-body.mjs`; raw PDF evidence and the DFF/delay
  geometry are unchanged. Pin names and order stay fixed, but changed pin
  columns can require manual repair of historical routes;
- triangular Analog Blocks (`opamp`, fully differential amps, voltage amps,
  comparators, and their lettered/polarity variants) share a user-requested
  equilateral outline with three 60-unit sides and a 60-degree apex. Its left
  vertical edge is anchored at x=-30, with both corners on the 10-unit grid;
  the apex is derived at x≈21.96. Input and output polarity marks use the
  differential gm block's equal 6-unit strokes with round caps, with clearance
  for both columns and internal text. The
  generators record `bodyNormalization: "equilateral-triangle"`; PDF extracts
  remain original evidence rather than being relabeled as equilateral. Pin
  names, order, input anchors, and polarity semantics are preserved. Outputs
  share x=30: single-ended terminals retract one 10-unit grid step from x=40,
  while differential terminals extend one step from x=20. Input leads are
  exactly 10 units, and the single-ended output lead extends about 8.04 units
  past the apex. The shared construction lives in `scripts/lib/analog-triangle.mjs`,
  and the op-amp
  generator also projects the comparator bodies;
- `opamp-wide` and `opamp-differential-wide` sit beside their compact versions
  in Analog Blocks. The 40-unit entries display **Op Amp** and **FD Amp**;
  the existing 20-unit entries display **Op Amp S** and **FD Amp S**. Tooltips
  explain the spacing; stored IDs and circuit instance names remain unchanged.
  Wide uses 40-unit input/output pairs in the same 60-unit
  equilateral body, keeping six-unit polarity marks inward of the pin rows; the existing 20-unit versions keep all original geometry.
  Input/output polarity swaps and internal body text have matching Wide states.
  `scripts/lib/wide-amplifier.mjs` derives each complete definition from its
  compact counterpart during `components:generate`/`components:check`, sharing
  subcircuit targets, port order and all electrical configuration. Projects
  retain the chosen Symbol ID; adding Wide never moves existing pins or routes;
- the Analog Blocks library includes the reference-calibrated single-input
  `transconductance` symbol and its user-requested house companion
  `differential-transconductance`. Both display `g_m` without a default unary
  plus; the differential form exposes `IN+`, `IN-`, and `OUT`.

`nmos` and `pmos` are the only MOS asset IDs in the Reference-calibrated
Razavi catalog. Their default visual variant is `textbook-3terminal`; explicit
bulk-capable variants remain properties of the same canonical assets. Optional
families such as high-voltage DMOS and Razavi-compatible depletion MOS live in
the separate Extended Devices catalog and do not claim Razavi visual
authority. The drawn VDD rail remains the explicit Net/Route authoring form;
`vdd-port` is its reviewed marker Symbol for placed-device authoring. New rails
and VDD Power default to local scope; VDD Power is a formal Cell Pin unless the
user explicitly selects Global. There is no legacy
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
