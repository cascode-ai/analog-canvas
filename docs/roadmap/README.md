# Delivery Roadmap

This directory contains only current cross-module work. Completed delivery
phases are preserved as historical evidence under
[`../archive/roadmap/`](../archive/roadmap/README.md); they are not default
implementation context.

## Delivery status

| Area                                                                      | Status                                                                    | Current authority                                                                                                                          |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Phases 0--8: contracts, editor, import, routing, export, manual authoring | complete                                                                  | [archived phase records](../archive/roadmap/README.md) and current specs/ADRs                                                              |
| Stage 1 schematic and netlist-semantic foundation                        | proposed                                                                  | [Stage 1 roadmap](stage-1-schematic-foundation.md)                                                                                         |
| Connectivity, routing, and electrical debugging                           | proposed follow-on; recovery and Net-contract prerequisites are complete | [unification plan](connectivity-routing-debugging-plan.md), [recovery record](../archive/roadmap/connectivity-recovery-status.md), and [Net-contract record](../archive/roadmap/net-contract-unification.md) |
| Schematic hierarchy authoring and adaptive symbols                        | proposed                                                                  | [authoring and visual plan](schematic-hierarchy-authoring-and-visual-plan.md)                                                              |
| Browser-authorized Agent sessions                                         | implementation validation complete; deployment review pending             | [session integration plan](web-agent-session-integration-plan.md) and [web-session spec](../specs/web-agent-session.md)                    |
| Current-only Agent/Project/asset contract                                 | implemented; branch validation in progress                                | [Agent API spec](../specs/agent-api.md) and [ADR 0019](../adr/0019-four-operation-agent-golden-contract.md)                                |

## Active planning rules

- A roadmap frames a cross-module outcome and its acceptance boundary; it does
  not own a working-tree change.
- A bounded target owns implementation, dirty-state handling, validation,
  and delivery evidence.
- An accepted spec or ADR overrides stale roadmap wording.
- Completed work moves to archive rather than remaining alongside open work.

Use [`phase.template.md`](phase.template.md) only for a new, genuinely staged
delivery phase.
