# Architecture Decision Records

ADRs explain architectural choices that remain relevant across modules, file
formats, public APIs, deployment, or long-term maintenance. Normative
specifications describe the complete current contract; ADRs explain why its
major boundaries exist.

## Current decisions

### Product and platform

- [`0001-project-document-without-page.md`](0001-project-document-without-page.md) — Project/Document model without a Page layer
- [`0002-typescript-core-and-tool-boundary.md`](0002-typescript-core-and-tool-boundary.md) — TypeScript product core and isolated tools
- [`0003-isolate-reference-sources.md`](0003-isolate-reference-sources.md) — pinned reference-source boundary
- [`0004-ngspice-46-core-structural-baseline.md`](0004-ngspice-46-core-structural-baseline.md) — ngspice structural baseline
- [`0006-portable-local-release.md`](0006-portable-local-release.md) — portable local web release
- [`0012-pdf-vector-evidence-for-razavi-assets.md`](0012-pdf-vector-evidence-for-razavi-assets.md) — scoped PDF vector evidence
- [`0017-deterministic-design-netlist-boundary.md`](0017-deterministic-design-netlist-boundary.md) — deterministic design-netlist boundary
- [`0021-coordinate-domains-and-grid-normalization.md`](0021-coordinate-domains-and-grid-normalization.md) — coordinate domains and grid normalization
- [`0023-rolling-previous-project-compatibility.md`](0023-rolling-previous-project-compatibility.md) — bounded current/previous Project compatibility
- [`0024-device-protocol-and-compatibility-boundaries.md`](0024-device-protocol-and-compatibility-boundaries.md) — device protocol boundaries
- [`0049-cloud-project-save-boundary.md`](0049-cloud-project-save-boundary.md) — stable Cloud Project Save
- [`0050-deterministic-digital-timing-simulation.md`](0050-deterministic-digital-timing-simulation.md) — internal timing layer with production-hidden tooling

### Agent boundary

- [`0005-transport-independent-agent-api.md`](0005-transport-independent-agent-api.md) — domain API independent of transport
- [`0007-snapshot-driven-agent-workflow.md`](0007-snapshot-driven-agent-workflow.md) — complete Snapshot and typed transaction workflow
- [`0008-agent-local-route-tree-expander.md`](0008-agent-local-route-tree-expander.md) — transient Agent-local RouteGraph expansion
- [`0016-browser-authoritative-agent-session.md`](0016-browser-authoritative-agent-session.md) — browser-authoritative authorization
- [`0019-four-operation-agent-golden-contract.md`](0019-four-operation-agent-golden-contract.md) — four-operation Circuit contract
- [`0020-agent-side-mcp-adapter.md`](0020-agent-side-mcp-adapter.md) — MCP adapter over the domain API

### Schematic, hierarchy, and presentation

- [`0010-text-annotation-drafting-schema.md`](0010-text-annotation-drafting-schema.md) — RichText annotation and drafting authority
- [`0025-schematic-hierarchy-and-formal-ports.md`](0025-schematic-hierarchy-and-formal-ports.md) — schematic Cell hierarchy
- [`0026-definition-level-cell-symbol-presentation.md`](0026-definition-level-cell-symbol-presentation.md) — definition-level Cell symbol intent
- [`0027-stage-1-netlist-authoring-protocol.md`](0027-stage-1-netlist-authoring-protocol.md) — typed netlist authoring facts
- [`0029-external-subcircuit-definition-protocol.md`](0029-external-subcircuit-definition-protocol.md) — external subcircuit definitions
- [`0030-instance-identity-and-placement-lifecycle.md`](0030-instance-identity-and-placement-lifecycle.md) — Instance identity and placement
- [`0033-schematic-identity-and-richtext-presentation.md`](0033-schematic-identity-and-richtext-presentation.md) — distinct schematic identities and RichText presentation
- [`0036-named-power-and-mos-bulk-semantics.md`](0036-named-power-and-mos-bulk-semantics.md) — named power and MOS bulk policy
- [`0038-document-style-overrides.md`](0038-document-style-overrides.md) — Document style overrides
- [`0046-independent-cell-pins-and-formal-port-projection.md`](0046-independent-cell-pins-and-formal-port-projection.md) — independent Cell Pins and derived Formal Ports

### Connectivity and routing

- [`0009-move-stretches-connected-routes.md`](0009-move-stretches-connected-routes.md) — topology-preserving movement
- [`0013-project-connectivity-index.md`](0013-project-connectivity-index.md) — shared Project connectivity index
- [`0014-resolved-route-geometry.md`](0014-resolved-route-geometry.md) — resolved Route geometry
- [`0015-object-locator-and-diagnostic-envelope.md`](0015-object-locator-and-diagnostic-envelope.md) — common locator and diagnostics
- [`0039-any-angle-route-authoring.md`](0039-any-angle-route-authoring.md) — one Route protocol with any-angle authoring
- [`0051-owner-explainable-logical-nets.md`](0051-owner-explainable-logical-nets.md) — Base Nets, typed names, and owner-explainable Logical Nets
- [`0052-net-name-authority-and-source-provenance.md`](0052-net-name-authority-and-source-provenance.md) — visible/current Net names versus non-electrical source spelling
- [`0041-physical-cut-and-endpoint-readiness.md`](0041-physical-cut-and-endpoint-readiness.md) — physical cut and endpoint readiness
- [`0044-imported-source-provenance.md`](0044-imported-source-provenance.md) — source provenance is not connectivity
- [`0047-stable-route-leg-model.md`](0047-stable-route-leg-model.md) — stable Route leg and bend identity
- [`0048-routing-operation-plan.md`](0048-routing-operation-plan.md) — evaluated routing-operation plan

## Lifecycle and deletion policy

```text
proposed -> accepted
proposed -> deleted when rejected or abandoned
accepted -> deleted when completely superseded
```

Git is the historical archive. `docs/adr/` contains only proposed decisions
still under review and accepted decisions that retain an active architectural
effect. A superseding change must first move every surviving current invariant
into its successor ADR or normative specification, update incoming links, and
then delete the obsolete ADR in the same target. The repository keeps no
superseded ADR directory and no long-lived `partially superseded` state.

Accepted decision rationale is not a rolling schema reference. Schema numbers,
migration examples, and implementation names inside an older ADR describe its
acceptance context; the current Project format and complete behavior are owned
by [`../specs/`](../specs/README.md) and executable contracts.

## Naming and scope

Use the next unique four-digit number and a short decision title:

```text
NNNN-short-decision-title.md
```

Create an ADR only when adding or removing a persistent model layer, changing
compatibility or connectivity semantics, introducing a public automation API,
selecting an external baseline, constraining deployment/licensing, or reversing
another active architectural decision. Routine module implementation belongs
in code, tests, and the commit that carries it.

Use [`adr.template.md`](adr.template.md) for a proposal.
