# Architecture Decision Records

ADRs are optional rationale, not a second specification. Complete current
contracts belong in specs; this directory retains only consequential choices
that need a separate explanation. See [documentation policy](../README.md).

## Current decisions

### Product and platform

- [`0001-project-document-without-page.md`](0001-project-document-without-page.md) — Project/Document model without a Page layer
- [`0002-typescript-core-and-tool-boundary.md`](0002-typescript-core-and-tool-boundary.md) — TypeScript product core and isolated tools
- [`0003-isolate-reference-sources.md`](0003-isolate-reference-sources.md) — pinned reference-source boundary
- [`0006-portable-local-release.md`](0006-portable-local-release.md) — portable local web release
- [`0012-pdf-vector-evidence-for-razavi-assets.md`](0012-pdf-vector-evidence-for-razavi-assets.md) — scoped PDF vector evidence
- [`0017-deterministic-design-netlist-boundary.md`](0017-deterministic-design-netlist-boundary.md) — deterministic design-netlist boundary
- [`0021-coordinate-domains-and-grid-normalization.md`](0021-coordinate-domains-and-grid-normalization.md) — coordinate domains and grid normalization
- [`0024-built-in-device-and-project-boundaries.md`](0024-built-in-device-and-project-boundaries.md) — built-in device and Project boundaries
- [`0049-cloud-project-save-boundary.md`](0049-cloud-project-save-boundary.md) — stable Cloud Project Save
- [`0053-chain-carried-project-compatibility.md`](0053-chain-carried-project-compatibility.md) — chain-carried Project compatibility with a floored upgrade chain
- [`0055-simulation-is-part-of-the-product.md`](0055-simulation-is-part-of-the-product.md) — simulation joins the product; what is simulatable, whose testbench, and where ngspice runs
- [`0057-release-channels-preview-and-production.md`](0057-release-channels-preview-and-production.md) — separate Preview and Production Workers sharing one accepted candidate
- [`0058-label-routed-releases.md`](0058-label-routed-releases.md) — the `preview` label routes a merge to Preview; every other merge deploys directly to Production

### Agent boundary

- [`0007-snapshot-driven-agent-workflow.md`](0007-snapshot-driven-agent-workflow.md) — transport-independent Circuit API, Snapshot and typed transactions
- [`0008-agent-local-route-tree-expander.md`](0008-agent-local-route-tree-expander.md) — transient Agent-local RouteGraph expansion
- [`0016-browser-authoritative-agent-session.md`](0016-browser-authoritative-agent-session.md) — browser-authoritative authorization
- [`0020-agent-side-mcp-adapter.md`](0020-agent-side-mcp-adapter.md) — MCP adapter over the domain API

### Schematic, hierarchy, and presentation

- [`0025-schematic-hierarchy-and-formal-ports.md`](0025-schematic-hierarchy-and-formal-ports.md) — schematic hierarchy and independent Cell Pins
- [`0027-stage-1-netlist-authoring-protocol.md`](0027-stage-1-netlist-authoring-protocol.md) — typed netlist authoring authority
- [`0029-external-subcircuit-definition-protocol.md`](0029-external-subcircuit-definition-protocol.md) — external subcircuit definitions
- [`0038-document-style-overrides.md`](0038-document-style-overrides.md) — Document style overrides
- [`0054-single-instance-reference-authority.md`](0054-single-instance-reference-authority.md) — one electrical Netlist Reference; in-place following or custom visual annotation

### Connectivity and routing

- [`0013-project-connectivity-index.md`](0013-project-connectivity-index.md) — shared Project connectivity index
- [`0014-resolved-route-geometry.md`](0014-resolved-route-geometry.md) — stable Route legs, shared geometry, and authoring modes
- [`0015-object-locator-and-diagnostic-envelope.md`](0015-object-locator-and-diagnostic-envelope.md) — common locator and diagnostics
- [`0041-physical-cut-and-endpoint-readiness.md`](0041-physical-cut-and-endpoint-readiness.md) — physical cut and endpoint readiness
- [`0048-routing-operation-plan.md`](0048-routing-operation-plan.md) — evaluated routing-operation plan and connection-preserving movement
- [`0052-owner-explainable-net-authority.md`](0052-owner-explainable-net-authority.md) — owner-explainable Net authority, named power, bulk policy, and provenance

## Retention test

Would deleting this ADR lose an important, still-relevant trade-off that neither
the code nor the spec explains?

- No: delete it after checking references.
- Yes, but a short explanation fits the spec: move that explanation there and delete it.
- Yes, and the cross-module choice needs separate treatment: keep a short ADR.

A major change is a reason to examine this test, not an automatic requirement
to create a record. Do not split one choice across several ADRs.

## Shape and lifecycle

Use [the template](adr.template.md): Decision first, with a direct link to the
owning spec section; then brief Context and Rationale. Explain the strongest
alternative only when it clarifies the actual trade-off. Do not repeat field
definitions, behavior rules, migration steps, validation lists or implementation
progress. Put proposed behavior in the proposed spec/roadmap, not a rival contract.

Keep a title, status (`proposed` or `accepted`) and accountable owner.
Use the next unique four-digit number and a descriptive filename; numbering is
identity, not evidence of value. Git owns dates and the decision history.

Rejected, abandoned, redundant or superseded records leave the current tree
after surviving content and incoming links are reconciled. No archive directory,
tombstone or permanent partially-superseded body is retained. Unresolved choices
must remain visible in the appropriate roadmap rather than disappearing in cleanup.
