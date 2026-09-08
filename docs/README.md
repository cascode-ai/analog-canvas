# Project Documentation

This directory describes the current product, its contracts, and unfinished
work. Git carries decision and delivery history; this directory is not an
archive of completed plans.

## Documentation map

| Area                                            | Purpose                                                                 |
| ----------------------------------------------- | ----------------------------------------------------------------------- |
| [User guides](user/getting-started.md)          | Editing, hierarchy, simulation, saving, compatibility, and known limits |
| [Product architecture](overall-product-plan.md) | System boundaries and sources of truth                                  |
| [Specifications](specs/README.md)               | Current data, interaction, API, execution, and export contracts         |
| [Architecture decisions](adr/README.md)         | Why the active architectural boundaries exist                           |
| [Agent guide](agent/README.md)                  | Authorized workflows and on-demand knowledge                            |
| [Roadmap](roadmap/README.md)                    | Remaining work and acceptance questions                                 |
| [Deployment](deployment.md)                     | Preview, Production, qualification, promotion, and recovery             |
| [Testing](testing/README.md)                    | Validation policy and contract ownership                                |
| [Experience](experience/README.md)              | Human-requested, evidence-backed reusable lessons                       |

## Contributor reading order

1. [Product architecture](overall-product-plan.md) and [working rules](../AGENTS.md).
2. [Schematic model](specs/schematic-model.md), [Edit Engine](specs/edit-engine.md),
   and [connectivity](specs/connectivity-and-routing.md) for electrical work.
3. [Visual contract](specs/razavi-visual-contract.md) and
   [visual language](specs/visual-language.md) for rendering work.
4. [Editor interaction](specs/editor-interaction.md), [Agent API](specs/agent-api.md),
   and [web sessions](specs/web-agent-session.md) for entry points.
5. [Simulation](specs/simulation.md) and [netlist export](specs/netlist-export.md)
   for the design-to-analysis boundary.
6. [Test system](testing/README.md) and the relevant domain's tests before editing.

Read only the domain references needed by the target. Agent-assisted schematic
work also follows the [Agent workflow](agent/workflow.md).

## Resolving disagreement

Specifications define the accepted current contract; ADRs explain its rationale.
Architecture summarizes those boundaries, and roadmaps propose unfinished work.
Implementation and tests establish what actually happens.

When behavior and a document disagree, inspect the behavior and its user-visible
consequences first. Preserve a deliberate, coherent evolution by updating the
contract; repair an accidental violation instead. A reasonable user outcome does
not automatically justify duplicated or ad hoc implementation. Record an ADR
only when the architectural decision changes, not for every correction.

## Keeping documentation small

- Replace an obsolete rule in place; do not append an amendment that leaves
  contradictory instructions active.
- Keep one owner for each contract and link to it instead of copying interfaces,
  schema histories, runtime limits, or delivery commands into several documents.
- Roadmaps contain remaining outcomes and acceptance criteria, not completed
  work-package logs or numbered discussion snapshots.
- Before deleting a plan or decision, preserve its still-valid invariants and
  unresolved questions in the appropriate current document. Update incoming
  links, then delete it; do not add a tombstone or archive copy.
- Bounded execution notes belong in untracked `plan/`. The commit owns what
  changed, why, validation, and deliberately unfinished work.
