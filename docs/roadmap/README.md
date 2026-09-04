# Delivery Roadmap

This directory contains current cross-module work and its acceptance
boundaries.

## Delivery status

| Area                                                  | Status                                                        | Current authority                                                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| SKY130 production export contract                     | implemented; full-delivery validation complete                | [bounded contract repair](sky130-production-export-contract.md)                                                         |
| Analog simulation: Cell reuse, Testbench, OP, AC, TRAN, raw SPICE | v13 is the latest full-scope handoff plan; current MVP scope and implementation status must be re-audited against accepted contracts, `main`, and Issue #585 | [latest full-scope vertical integration plan](simulation-vertical-integration-plan-v13.md) |
| Net naming, global projection, and export correctness | proposed C0, P0-P2                                            | [staged boundary and delivery plan](net-naming-resolution-export-p0.md)                                                 |
| Connectivity, routing, and electrical debugging       | active                                                        | [unification plan](connectivity-routing-debugging-plan.md)                                                              |
| Browser-authorized Agent sessions                     | implementation validation complete; deployment review pending | [session integration plan](web-agent-session-integration-plan.md) and [web-session spec](../specs/web-agent-session.md) |
| Current-only Agent/Project/asset contract             | implemented; branch validation in progress                    | [Agent API spec](../specs/agent-api.md) and [ADR 0007](../adr/0007-snapshot-driven-agent-workflow.md)                   |

## Simulation plan history

These are retained discussion snapshots, not current planning or accepted
product authority: [v1](simulation-vertical-integration-plan.md) ·
[v2](simulation-vertical-integration-plan-v2.md) ·
[v3](simulation-vertical-integration-plan-v3.md) ·
[v4](simulation-vertical-integration-plan-v4.md) ·
[v5](simulation-vertical-integration-plan-v5.md) ·
[v6](simulation-vertical-integration-plan-v6.md) ·
[v7](simulation-vertical-integration-plan-v7.md) ·
[v8](simulation-vertical-integration-plan-v8.md) ·
[v9](simulation-vertical-integration-plan-v9.md) ·
[v10](simulation-vertical-integration-plan-v10.md) ·
[v11](simulation-vertical-integration-plan-v11.md) ·
[v12](simulation-vertical-integration-plan-v12.md).

## Active planning rules

- A roadmap frames a cross-module outcome and its acceptance boundary; it does
  not own a working-tree change.
- A bounded target owns implementation, dirty-state handling, validation,
  and delivery evidence.
- An accepted spec or ADR overrides stale roadmap wording.

Use [`phase.template.md`](phase.template.md) only for a new, genuinely staged
delivery phase.
