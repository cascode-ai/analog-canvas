# Razavi v1 Symbol Assets

This directory is the runtime catalog for the user-approved Razavi style.

`fixtures/visual-reference/razavi-reference-v1/manifest.json` is the only
visual authority. A catalog entry may appear in the Razavi palette only when
it is both `reviewed` and has:

```json
"visualAuthority": { "kind": "razavi-reference-v1", "...": "..." }
```

The product set is exactly the reviewed, Reference-calibrated entries:

- `nmos`, `pmos`, and `ground`;
- `voltage-source`, `current-source`;
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
- the behavioral block family `inverter`, `and-gate`, `or-gate`, `nand-gate`,
  `nor-gate`, `xor-gate`, `xnor-gate`, `buffer`, `delay-cell`,
  `d-flip-flop`, `comparator`, and its polarity-unmarked sibling
  `comparator-unmarked` (manual-only netlist mapping, like `opamp`). Inverter, AND,
  NAND, NOR, and XOR use hash-pinned native-vector evidence from textbook
  Figures 16.2, 16.24, and 16.25. Buffer and the generic D/CK/Q/Q-bar flip-flop
  use direct evidence from Figures 16.53(a) and 16.23(a). `delay-cell` uses the
  rectangular `Delta-T` stage from _Analysis and Design of Data Converters_,
  printed page 331, Figure 16.2(c); its timing and netlist implementation remain
  deliberately unmapped. OR is the reviewed NOR body without its output
  bubble; XNOR is the direct XOR body with the reviewed two-input NOR negation
  bubble.

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

`catalog.json` is the source. `packages/symbols/src/razavi-catalog.generated.ts`
is generated from it; do not edit that adapter manually.

Update and verify it with:

```powershell
pnpm symbols:razavi
pnpm symbols:razavi:check
```
