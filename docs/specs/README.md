# Normative Specifications

Specifications define stable contracts that multiple modules implement
against. They describe required behavior and invariants, not task history.

## Specifications

| Specification                                                | Status   | Covers                                                                                   |
| ------------------------------------------------------------ | -------- | ---------------------------------------------------------------------------------------- |
| [`project-file-format.md`](project-file-format.md)           | accepted | Project JSON, source manifest, symbol lock, canonical save/load                          |
| [`schematic-model.md`](schematic-model.md)                   | accepted | Document, instance, net, route, junction, annotation, presentation                       |
| [`edit-engine.md`](edit-engine.md)                           | accepted | Typed edits, transactions, revision, undo/redo, atomicity                                |
| [`circuit-ir.md`](circuit-ir.md)                             | accepted | Transient dialect-neutral import boundary                                                |
| [`symbol-dsl.md`](symbol-dsl.md)                             | accepted | Geometry, electrical/visual pins, variants, validation                                   |
| [`spice-frontend.md`](spice-frontend.md)                     | accepted | Lossless syntax, dialects, includes, expressions, elaboration                            |
| [`simulation.md`](simulation.md)                             | accepted | Saved setups, Testbench roots, expressions, sources, and structured compilation          |
| [`simulation-execution.md`](simulation-execution.md)         | accepted | Profiles, preparation, execution, retention, File artifacts, and qualification           |
| [`simulation-results.md`](simulation-results.md)             | accepted | Numeric evidence, rawfiles, units, measurements, and CSV                                 |
| [`connectivity-and-routing.md`](connectivity-and-routing.md) | accepted | Physical/Logical Nets, Route graph, contacts, guidance, cuts, and locks                  |
| [`visual-language.md`](visual-language.md)                   | accepted | Razavi visual tokens, annotations, overlays, golden output                               |
| [`razavi-visual-contract.md`](razavi-visual-contract.md)     | accepted | Razavi authority, construction, interface-symbol semantics, exposure, and pixel fidelity |
| [`agent-api.md`](agent-api.md)                               | accepted | API 2.0 Snapshot, typed edits, render, permissions, and sibling resources                |
| [`persistence-and-recovery.md`](persistence-and-recovery.md) | accepted | Atomic save, AppData cache/session/recovery, migrations                                  |
| [`export.md`](export.md)                                     | accepted | Formal SVG source and derived PNG/PDF contracts                                          |
| [`netlist-export.md`](netlist-export.md)                     | accepted | Deterministic structural SPICE/Spectre export and diagnostics                            |
| [`performance.md`](performance.md)                           | accepted | Representative workloads and release budgets                                             |
| [`editor-interaction.md`](editor-interaction.md)             | accepted | Direct manipulation, manual authoring, gestures, and automation boundary                 |
| [`web-agent-session.md`](web-agent-session.md)               | accepted | Browser-authoritative relay: scopes, transport, events, errors, threat                   |
| [`community-gallery.md`](community-gallery.md)               | accepted | Public feed, advisory quality checks, accounts, moderation, re-serialization             |

Create a specification when a stable cross-module contract is needed; do not
create empty files only to mirror this table. Start from
[`spec.template.md`](spec.template.md).

## Specification Rules

- State status and ownership. State a version only for an independently
  versioned contract, and link related ADRs when architectural rationale is
  required.
- Define invariants and failure behavior, not only successful examples.
- Include at least one valid example and one rejected example.
- Distinguish persisted data, transient data, and derived data.
- Name deterministic validation that demonstrates the contract.
- Changes after acceptance require compatibility analysis and, when
  architectural, an ADR.
- A package-internal experiment does not become a normative product
  specification merely because code remains in the repository. Its local
  README and tests own that implementation until the product adopts it.
