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
- [`0024-built-in-device-and-project-boundaries.md`](0024-built-in-device-and-project-boundaries.md) — built-in device and Project boundaries
- [`0049-cloud-project-save-boundary.md`](0049-cloud-project-save-boundary.md) — stable Cloud Project Save
- [`0053-chain-carried-project-compatibility.md`](0053-chain-carried-project-compatibility.md) — chain-carried Project compatibility with a floored upgrade chain

### Agent boundary

- [`0005-transport-independent-agent-api.md`](0005-transport-independent-agent-api.md) — domain API independent of transport
- [`0007-snapshot-driven-agent-workflow.md`](0007-snapshot-driven-agent-workflow.md) — complete Snapshot and typed transaction workflow
- [`0008-agent-local-route-tree-expander.md`](0008-agent-local-route-tree-expander.md) — transient Agent-local RouteGraph expansion
- [`0016-browser-authoritative-agent-session.md`](0016-browser-authoritative-agent-session.md) — browser-authoritative authorization
- [`0020-agent-side-mcp-adapter.md`](0020-agent-side-mcp-adapter.md) — MCP adapter over the domain API

### Schematic, hierarchy, and presentation

- [`0025-schematic-hierarchy-and-formal-ports.md`](0025-schematic-hierarchy-and-formal-ports.md) — schematic hierarchy and independent Cell Pins
- [`0027-stage-1-netlist-authoring-protocol.md`](0027-stage-1-netlist-authoring-protocol.md) — typed netlist authoring authority
- [`0029-external-subcircuit-definition-protocol.md`](0029-external-subcircuit-definition-protocol.md) — external subcircuit definitions
- [`0036-named-power-and-mos-bulk-semantics.md`](0036-named-power-and-mos-bulk-semantics.md) — named power and MOS bulk policy
- [`0038-document-style-overrides.md`](0038-document-style-overrides.md) — Document style overrides
- [`0054-single-instance-reference-authority.md`](0054-single-instance-reference-authority.md) — one authored Instance Reference across canvas, copy, Agent, and export
- [`0055-simulation-is-part-of-the-product.md`](0055-simulation-is-part-of-the-product.md) — simulation joins the product; what is simulatable, whose testbench, and where ngspice runs

### Connectivity and routing

- [`0009-move-stretches-connected-routes.md`](0009-move-stretches-connected-routes.md) — topology-preserving movement
- [`0013-project-connectivity-index.md`](0013-project-connectivity-index.md) — shared Project connectivity index
- [`0014-resolved-route-geometry.md`](0014-resolved-route-geometry.md) — stable Route legs and resolved geometry
- [`0015-object-locator-and-diagnostic-envelope.md`](0015-object-locator-and-diagnostic-envelope.md) — common locator and diagnostics
- [`0039-any-angle-route-authoring.md`](0039-any-angle-route-authoring.md) — one Route protocol with any-angle authoring
- [`0041-physical-cut-and-endpoint-readiness.md`](0041-physical-cut-and-endpoint-readiness.md) — physical cut and endpoint readiness
- [`0048-routing-operation-plan.md`](0048-routing-operation-plan.md) — evaluated routing-operation plan
- [`0052-owner-explainable-net-authority.md`](0052-owner-explainable-net-authority.md) — owner-explainable Net authority and non-electrical provenance

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
