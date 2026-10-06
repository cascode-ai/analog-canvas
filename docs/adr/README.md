# Architecture Decisions

Specs own current rules. ADRs explain consequential choices and accepted costs.
New decisions follow the original domain-modeling format; the existing topic
documents below retain useful background and link their owning contracts.

| Topic                 | Rationale                                                                            |
| --------------------- | ------------------------------------------------------------------------------------ |
| Product core          | [Shared model and transaction authority](product-core.md)                            |
| Resources             | [Component ownership and visual/research evidence](resources.md)                     |
| Presentation          | [Coordinates, style composition and formal output](presentation.md)                  |
| Net                   | [Physical membership, logical identity and diagnostic evidence](net-connectivity.md) |
| Routing               | [Shared geometry, stable identities and evaluated operations](routing.md)            |
| Hierarchy and netlist | [Interfaces, references and deterministic export](hierarchy-netlist.md)              |
| Agent                 | [Browser authority, transports and scoped resources](agent.md)                       |
| Persistence           | [Save, recovery and file compatibility](persistence.md)                              |
| Simulation            | [Authored experiment, execution and result boundaries](simulation.md)                |
| Deployment            | [Production-only delivery and retained storage](deployment.md)                       |

## Retention test

Offer a new ADR only when all original criteria hold:

1. The choice is hard to reverse.
2. It would be surprising without its context.
3. It resulted from a real trade-off between alternatives.

Create records lazily, not to fill a directory or reconstruct every past choice.
Retain existing explanations while they preserve an important current reason;
update their incoming references when their content is actually superseded.

## Shape and lifecycle

New ADRs use `0001-slug.md`, incrementing the highest existing number. Follow
the [original format](../../.agents/skills/domain-modeling/ADR-FORMAT.md) and
[template](adr.template.md): a title and one to three sentences for context,
choice and reason can be sufficient. Status, alternatives and consequences are
optional. A new numbered record need not add a row to this background index.

Existing unnumbered topic explanations keep their indexed names and status.
Link them when a new decision reopens a relevant trade-off; do not copy their
whole body or create numbered copies just to change format. Link accepted
contracts rather than duplicating schemas or operation lists. Unresolved
product behavior belongs in its Issue, not an accepted decision.
