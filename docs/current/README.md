# Current Documentation

This is the default reading set for product work. Do not begin with broad
repository search, completed roadmaps, target plans, or `docs/archive/`.

## Read in this order

1. [`../overall-product-plan.md`](../overall-product-plan.md) — product
   boundary, system shape, and source-of-truth map.
2. [`../adr/0022-current-protocol-baseline.md`](../adr/0022-current-protocol-baseline.md),
   [`../adr/0023-rolling-previous-project-compatibility.md`](../adr/0023-rolling-previous-project-compatibility.md),
   [`../adr/0024-device-protocol-and-compatibility-boundaries.md`](../adr/0024-device-protocol-and-compatibility-boundaries.md),
   [`../adr/0026-definition-level-cell-symbol-presentation.md`](../adr/0026-definition-level-cell-symbol-presentation.md),
   [`../adr/0027-stage-1-netlist-authoring-protocol.md`](../adr/0027-stage-1-netlist-authoring-protocol.md),
   [`../adr/0029-external-subcircuit-definition-protocol.md`](../adr/0029-external-subcircuit-definition-protocol.md),
   [`../adr/0030-instance-identity-and-placement-lifecycle.md`](../adr/0030-instance-identity-and-placement-lifecycle.md),
   [`../adr/0031-schematic-reference-and-port-lifecycle.md`](../adr/0031-schematic-reference-and-port-lifecycle.md),
   [`../adr/0032-formal-port-display-and-retained-annotations.md`](../adr/0032-formal-port-display-and-retained-annotations.md),
   [`../adr/0033-port-semantic-name-and-richtext-presentation.md`](../adr/0033-port-semantic-name-and-richtext-presentation.md),
   [`../adr/0034-top-cell-formal-port-and-free-port-export.md`](../adr/0034-top-cell-formal-port-and-free-port-export.md),
   [`../adr/0035-imported-net-routing-guidance.md`](../adr/0035-imported-net-routing-guidance.md),
   [`../adr/0036-named-power-and-mos-bulk-semantics.md`](../adr/0036-named-power-and-mos-bulk-semantics.md),
   and [`../adr/0037-repeated-formal-port-markers.md`](../adr/0037-repeated-formal-port-markers.md)
   — current Project shape, rolling previous-version read policy, independent
   device and compatibility boundaries, Port-symbol, edit-union, schema-22
   identity and placement lifecycle, schematic references, Port semantic names
   and RichText display, top-Cell formal interfaces, Free Net Port export,
   imported routing guidance, named-power/MOS-bulk semantics, repeated formal
   Port markers, and Agent credential contract; identify superseded
   clauses in older ADRs.
3. [`../adr/0011-retire-visio-vss-as-visual-authority.md`](../adr/0011-retire-visio-vss-as-visual-authority.md)
   and [`../specs/razavi-visual-contract.md`](../specs/razavi-visual-contract.md)
   — the Razavi raster is the sole visual authority.
4. [`../specs/schematic-model.md`](../specs/schematic-model.md),
   [`../specs/edit-engine.md`](../specs/edit-engine.md), and
   [`../specs/connectivity-and-routing.md`](../specs/connectivity-and-routing.md)
   — electrical and editing invariants.
5. [`../specs/editor-interaction.md`](../specs/editor-interaction.md),
   [`../specs/agent-api.md`](../specs/agent-api.md), and
   [`../specs/web-agent-session.md`](../specs/web-agent-session.md) — human
   and Agent entry points.
6. [`../agent/workflow.md`](../agent/workflow.md) — required Agent execution
   and visual review loop.

Read a targeted roadmap, plan, user guide, or archive item only when the
current task explicitly requires its history or acceptance evidence.

## Archive boundary

[`../archive/README.md`](../archive/README.md) contains historical records.
They are not authoritative and must not supply current implementation rules.
