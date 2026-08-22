# Architecture Decision Records

ADRs record decisions that materially affect multiple modules, file formats,
public APIs, compatibility, security, or long-term maintenance.

## Naming

```text
NNNN-short-decision-title.md
```

Examples:

```text
0001-project-document-without-page.md
0002-lossless-spice-tree.md
0003-agent-api-without-mcp.md
```

Current Agent integration decisions include
[`0005-agent-api-without-mcp.md`](0005-agent-api-without-mcp.md),
[`0007-snapshot-driven-agent-workflow.md`](0007-snapshot-driven-agent-workflow.md),
[`0008-agent-local-route-tree-expander.md`](0008-agent-local-route-tree-expander.md),
[`0009-move-stretches-connected-routes.md`](0009-move-stretches-connected-routes.md),
and [`0010-text-annotation-drafting-schema.md`](0010-text-annotation-drafting-schema.md).
The active visual-authority decision is
[`0011-retire-visio-vss-as-visual-authority.md`](0011-retire-visio-vss-as-visual-authority.md).
The browser-authoritative web session decision is
[`0016-browser-authoritative-agent-session.md`](0016-browser-authoritative-agent-session.md).
The deterministic structural netlist decision is
[`0017-deterministic-design-netlist-boundary.md`](0017-deterministic-design-netlist-boundary.md).
The current Agent API reliability decision is
[`0019-four-operation-agent-golden-contract.md`](0019-four-operation-agent-golden-contract.md).
The Agent-side local MCP adapter decision (ADR 0005/0016 keep their
domain-independence judgments) is
[`0020-agent-side-mcp-adapter.md`](0020-agent-side-mcp-adapter.md).
The coordinate-domain and current-only grid-normalization decision is
[`0021-coordinate-domains-and-grid-normalization.md`](0021-coordinate-domains-and-grid-normalization.md).
The current Project schema, ordinary Port-symbol Instance, typed-edit, and
Agent credential-lifetime baseline—partially superseding clauses in ADR
0010/0013/0014/0015/0016—is
[`0022-current-protocol-baseline.md`](0022-current-protocol-baseline.md).
The rolling current-and-previous Project read policy, superseding ADR 0022's
current-only compatibility clause, is
[`0023-rolling-previous-project-compatibility.md`](0023-rolling-previous-project-compatibility.md).
The independent current-device registry and Project compatibility-boundary
decision is
[`0024-device-protocol-and-compatibility-boundaries.md`](0024-device-protocol-and-compatibility-boundaries.md).
The schematic-only hierarchy, formal Cell Port, structural transaction, and
schema-12 decision is
[`0025-schematic-hierarchy-and-formal-ports.md`](0025-schematic-hierarchy-and-formal-ports.md).
The schema-13 definition-level Cell symbol presentation decision is
[`0026-definition-level-cell-symbol-presentation.md`](0026-definition-level-cell-symbol-presentation.md).
The accepted Stage 1 schema-14 netlist-authoring contract, which preserves the
current schematic GUI while unifying typed netlist facts, is
[`0027-stage-1-netlist-authoring-protocol.md`](0027-stage-1-netlist-authoring-protocol.md).
The single Route geometry and octilinear authoring decision is
[`0028-octilinear-route-geometry-protocol.md`](0028-octilinear-route-geometry-protocol.md).
The project-local external interface and `X`-call preservation decision is
[`0029-external-subcircuit-definition-protocol.md`](0029-external-subcircuit-definition-protocol.md).
The instance identity, Placement Tray lifecycle, and presentation-only
netlist-invariance decision is
[`0030-instance-identity-and-placement-lifecycle.md`](0030-instance-identity-and-placement-lifecycle.md).
The schematic-reference and unified Port lifecycle decision is
[`0031-schematic-reference-and-port-lifecycle.md`](0031-schematic-reference-and-port-lifecycle.md).
The formal-Port terminal-name display and retained-annotation visibility
decision is
[`0032-formal-port-display-and-retained-annotations.md`](0032-formal-port-display-and-retained-annotations.md).
The unified free/formal Port semantic-name and same-text RichText presentation
decision is
[`0033-port-semantic-name-and-richtext-presentation.md`](0033-port-semantic-name-and-richtext-presentation.md).
The top-Cell formal interface and non-emitting Free Net Port decision is
[`0034-top-cell-formal-port-and-free-port-export.md`](0034-top-cell-formal-port-and-free-port-export.md).
The imported-Net provenance and derived routing-guidance decision is
[`0035-imported-net-routing-guidance.md`](0035-imported-net-routing-guidance.md).
The named-power, Power Rail, and MOS bulk-default decision is
[`0036-named-power-and-mos-bulk-semantics.md`](0036-named-power-and-mos-bulk-semantics.md).
The repeated formal-Port marker and schema-20 decision is
[`0037-repeated-formal-port-markers.md`](0037-repeated-formal-port-markers.md).
The document style-overrides and schema-21 decision is
[`0038-document-style-overrides.md`](0038-document-style-overrides.md).
The arbitrary-angle Route authoring decision is
[`0039-any-angle-route-authoring.md`](0039-any-angle-route-authoring.md).

Use [`adr.template.md`](adr.template.md) for new decisions.

## When an ADR is required

- Adding or removing a persistent model layer;
- changing the Project file format or compatibility policy;
- introducing a public Agent or automation API;
- selecting the authoritative SPICE dialect baseline;
- changing junction, crossing, or connectivity semantics;
- introducing a dependency that constrains licensing or deployment;
- reversing an accepted architectural decision.

Routine implementation choices contained inside one module do not require an
ADR unless they alter a shared contract.

## Lifecycle

```text
proposed → accepted → superseded
                 ↘ rejected
```

Accepted ADRs are immutable historical records. A later decision supersedes
an earlier ADR by linking both documents rather than rewriting history.
