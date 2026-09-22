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
| [Architecture decisions](adr/README.md)         | Optional rationale for consequential architectural choices              |
| [Agent guide](agent/README.md)                  | Authorized workflows and on-demand knowledge                            |
| [Roadmap](roadmap/README.md)                    | Remaining work and acceptance questions                                 |
| [Deployment](deployment.md)                     | Production delivery, verification, rollback, and retained storage      |
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

Specifications are the single authority for accepted current contracts; optional
ADRs explain consequential choices by linking to the relevant spec section.
Architecture summarizes those boundaries, and roadmaps propose unfinished work.
Implementation and tests establish what actually happens.

When behavior and a document disagree, inspect the behavior and its user-visible
consequences first. Preserve a deliberate, coherent evolution by updating the
contract; repair an accidental violation instead. A reasonable user outcome does
not automatically justify duplicated or ad hoc implementation. Surface unresolved
behavior disagreements for a product decision; do not silently endorse an accident
or restore an obsolete rule just to make the documents agree.

## Content admission and authority

Keep a document only when it helps someone use, maintain or decide something
about the current system. Reuse the existing topic owner before creating a file.

- **Specs:** one authoritative location per contract. Define current boundaries,
  invariants and failure behavior. Link executable schemas for exact shapes;
  do not maintain another complete copy. Put short design reasons beside the rule.
- **ADRs:** optional, only for important cross-module trade-offs whose rationale
  cannot be explained adequately beside the spec. Decision summarizes the choice
  and links the spec; Context and Rationale add only unique constraints, reasons
  and accepted costs. No independent contract, migration plan or test checklist.
- **Guides:** explain actions for their audience and link contracts. Do not
  maintain separate field definitions, limits or safety rules.
- **Roadmaps:** unresolved outcomes and acceptance boundaries only. Local task
  plans, progress, completed work packages and delivery evidence belong in
  ignored `plan/` or the owning commit/PR, not in current product documentation.
- **Experience:** human-requested transferable judgment with evidence and limits,
  never another contract, path inventory or implementation diary.

Architecture and indexes provide navigation, not another copy of each topic.
Templates are starting points, not mandatory forms: omit empty or irrelevant
sections and boilerplate. A new architectural change does not itself require
a new ADR. Apply the [ADR retention test](adr/README.md#retention-test).

## Images and attachments

Every documentation asset needs a current purpose, an owning topic and an
explicit reference from that topic. Keep necessary illustrations beside their
topic; do not accumulate a general screenshot archive under `docs/`.

- Explanatory images belong with the current guide or contract that uses them.
- Test inputs, visual goldens and calibration authorities belong in the existing
  fixture/asset system; link them rather than copying them into documentation.
- Incident screenshots, run reports and one-off review evidence belong in the
  Issue/PR or commit record, not the current documentation tree.
- Remove unreferenced assets after checking repository consumers. Never delete
  a test fixture or pinned reference merely because no Markdown links to it.

## Editing and retirement

Replace obsolete statements in place; do not append amendments that leave both
versions active. Keep current compatibility limits where needed, but put
migration chronology, past release announcements and repair stories in Git.

Before merging or deleting documents, move only unique, still-valid constraints
or rationale into their topic owner. Keep real unresolved questions in the
roadmap. Update incoming links, then delete redundant files and unused assets;
do not create tombstones, archive copies or cleanup reports.

Check code and relevant tests, references, heading targets and asset consumers.
A passing link checker is not proof of semantic consistency or absence of
duplication. Preserve published Agent-resource contracts when moving their
sources: update the manifest and generated projections within an explicitly
owned target. Do not retire registered resource content as an ordinary orphan.
