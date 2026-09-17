# Architecture Rationale

Specs own current rules. These topic documents explain consequential choices
and accepted costs; they do not repeat schemas, operation lists or release
history. Start with the topic, then follow its Decision links to the contracts.

| Topic                 | Rationale                                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------- |
| Product core          | [Shared model and transaction authority](0002-typescript-core-and-tool-boundary.md)                      |
| Resources             | [Component ownership and visual/research evidence](0024-built-in-device-and-project-boundaries.md)       |
| Presentation          | [Coordinates, style composition and formal output](0021-coordinate-domains-and-grid-normalization.md)    |
| Net                   | [Physical membership, logical identity and diagnostic evidence](0052-owner-explainable-net-authority.md) |
| Routing               | [Shared geometry, stable identities and evaluated operations](0014-resolved-route-geometry.md)           |
| Hierarchy and netlist | [Interfaces, references and deterministic export](0017-deterministic-design-netlist-boundary.md)         |
| Agent                 | [Browser authority, transports and scoped resources](0007-snapshot-driven-agent-workflow.md)             |
| Persistence           | [Save, recovery and file compatibility](0049-cloud-project-save-boundary.md)                             |
| Simulation            | [Authored experiment, execution and result boundaries](0055-simulation-is-part-of-the-product.md)        |
| Deployment            | [Channel isolation, routing and candidate promotion](0057-release-channels-preview-and-production.md)    |

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
in the roadmap, not an accepted rationale. Numbered filenames remain stable
identifiers; they are not a sequence of implementation tasks.
