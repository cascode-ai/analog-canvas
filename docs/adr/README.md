# Architecture Decisions

Specs own current rules; an ADR records why a hard-to-reverse choice was made
and links the spec instead of restating it.

| Topic                 | Decision                                                                             |
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
| Deployment            | [Production-only delivery, one regional release, retained storage](deployment.md)    |

## Retention test

Add an ADR only when the choice is hard to reverse, surprising without its
reason, and a real trade-off. New ADRs are `0001-slug.md` in the
[original format](../../.agents/skills/domain-modeling/ADR-FORMAT.md), using the
[template](adr.template.md). Topic ADRs keep `Status:` and their row here.
