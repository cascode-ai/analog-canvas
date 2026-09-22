# Architecture Rationale

Specs own current rules. These topic documents explain consequential choices
and accepted costs; they do not repeat schemas, operation lists or release
history. Start with the topic, then follow its Decision links to the contracts.

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

Would removal lose an important, current design reason?

- No: remove it and repair incoming references.
- A short reason fits beside the rule: put it in the owning spec.
- A consequential cross-module trade-off needs explanation: keep it in the
  existing topic here. Add a topic only for a genuinely distinct boundary.

## Shape and lifecycle

Follow [documentation policy](../README.md) and the [template](adr.template.md):
Decision links the owning spec; Context states the constraint; Rationale
explains the choice and its cost. Keep only a title, status and accountable
owner before those sections.

Update a topic in place instead of adding an amendment ADR. Git owns chronology.
Do not retain superseded bodies, copied field definitions, compatibility-step
histories, validation checklists or archive indexes. Unresolved behavior belongs
in the roadmap, not an accepted rationale. Use short, descriptive lowercase
kebab-case filenames without numeric prefixes; titles name the topic, not a
decision number. References use the topic name and link to its document.
