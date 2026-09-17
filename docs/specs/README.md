# Normative Specifications

Specifications define stable contracts that multiple modules implement
against. They describe required behavior and invariants, not task history.

## Specifications

| Specification                                                | Status   | Covers                                                                                      |
| ------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------- |
| [`project-file-format.md`](project-file-format.md)           | accepted | Project JSON, source manifest, symbol lock, canonical save/load                             |
| [`schematic-model.md`](schematic-model.md)                   | accepted | Document, instance, net, route, junction, annotation, presentation                          |
| [`edit-engine.md`](edit-engine.md)                           | accepted | Typed edits, transactions, revision, undo/redo, atomicity                                   |
| [`circuit-ir.md`](circuit-ir.md)                             | accepted | Transient dialect-neutral import boundary                                                   |
| [`symbol-dsl.md`](symbol-dsl.md)                             | accepted | Geometry, electrical/visual pins, variants, validation                                      |
| [`spice-frontend.md`](spice-frontend.md)                     | accepted | Lossless syntax, dialects, includes, expressions, elaboration                               |
| [`simulation.md`](simulation.md)                             | accepted | Source folders, native/legacy configuration, mapped edits, compilation and Code interaction |
| [`simulation-execution.md`](simulation-execution.md)         | accepted | Profiles, preparation, execution, retention, File artifacts, and qualification              |
| [`simulation-results.md`](simulation-results.md)             | accepted | Numeric evidence, rawfiles, units, measurements, and CSV                                    |
| [`connectivity-and-routing.md`](connectivity-and-routing.md) | accepted | Physical/Logical Nets, Route graph, contacts, guidance, cuts, and locks                     |
| [`visual-language.md`](visual-language.md)                   | accepted | Razavi visual tokens, annotations, overlays, golden output                                  |
| [`razavi-visual-contract.md`](razavi-visual-contract.md)     | accepted | Razavi authority, construction, interface-symbol semantics, exposure, and pixel fidelity    |
| [`agent-api.md`](agent-api.md)                               | accepted | API 3.0 Snapshot, typed edits, render, permissions, and sibling resources                   |
| [`persistence-and-recovery.md`](persistence-and-recovery.md) | accepted | Cloud Project save, browser recovery records, unsaved state, recovery migration             |
| [`export.md`](export.md)                                     | accepted | Formal SVG source and derived PNG/PDF contracts                                             |
| [`netlist-export.md`](netlist-export.md)                     | accepted | Deterministic structural SPICE/Spectre export and diagnostics                               |
| [`netlist-conversion.md`](netlist-conversion.md)             | accepted | SPICE/SCS structural conversion, HTTP protocol and import rejection boundaries              |
| [`performance.md`](performance.md)                           | accepted | Representative workloads and release budgets                                                |
| [`editor-interaction.md`](editor-interaction.md)             | accepted | Direct manipulation, manual authoring, gestures, and automation boundary                    |
| [`web-agent-session.md`](web-agent-session.md)               | accepted | Browser-authoritative relay: scopes, transport, events, errors, threat                      |
| [`community-gallery.md`](community-gallery.md)               | accepted | Public feed, advisory quality checks, accounts, moderation, re-serialization                |

Create a specification when a stable cross-module contract is needed; do not
create empty files only to mirror this table. Start from
[`spec.template.md`](spec.template.md).

## Specification Rules

Follow the [documentation policy](../README.md). A topic owns its contract once;
other specs, guides and ADRs link to that owner instead of redefining it.

- State status, accountable module and scope. Use a version only when the
  contract has an independent version.
- Describe invariants, ownership, meaningful transitions and failure behavior.
  Distinguish persisted, transient and derived facts where relevant.
- Link canonical schemas and focused tests instead of copying full interfaces
  or validation commands. Add small examples only when they clarify a boundary.
- Include short design reasons beside the rule. A separate ADR is optional
  and must pass its [retention test](../adr/README.md#retention-test).
- Review compatibility when changing an accepted contract; describe the current
  supported boundary, not the history of every migration.
- Omit irrelevant template sections. Keep unresolved product decisions in the
  roadmap rather than calling them accepted behavior.
- Package-internal experiments stay with their local README and tests until
  adopted as product contracts.

When code disagrees, inspect behavior and consequences before choosing which
side to correct. Neither existing code nor an accepted status proves a rule
is reasonable.
