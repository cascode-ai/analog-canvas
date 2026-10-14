# Normative Specifications

Specs hold the rules and contracts several modules, tests or other repos rely
on. Each topic has one owner spec; others link to it.

| Specification                                                      | Covers                                                                 |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| [`project-file-format.md`](project-file-format.md)                 | Project JSON, compatibility floor, canonical save/load                 |
| [`schematic-model.md`](schematic-model.md)                         | Instances, Nets, Routes, Cell Pins, annotations (sole owner)           |
| [`edit-engine.md`](edit-engine.md)                                 | Typed edits, transactions, revisions, Undo (sole owner)                |
| [`circuit-ir.md`](circuit-ir.md)                                   | Transient dialect-neutral import IR                                    |
| [`symbol-dsl.md`](symbol-dsl.md)                                   | Symbol pins, variants, source-backed artwork, User Components          |
| [`component-publication.md`](component-publication.md)             | User Component identity, exact content, destination, write recovery   |
| [`spice-frontend.md`](spice-frontend.md)                           | Lossless SPICE syntax, includes, dialect profiles, elaboration         |
| [`simulation.md`](simulation.md)                                   | Source folders, configuration, compilation                             |
| [`simulation-execution.md`](simulation-execution.md)               | Profiles, preparation, execution, artifacts                            |
| [`simulation-results.md`](simulation-results.md)                   | Rawfile reading, numeric result data, CSV                              |
| [`simulation-evidence-storage.md`](simulation-evidence-storage.md) | Evidence admission, reclamation, leased Agent downloads                |
| [`connectivity-and-routing.md`](connectivity-and-routing.md)       | Physical/Logical Nets, contacts, cuts (sole owner)                     |
| [`visual-language.md`](visual-language.md)                         | Formal scene, text/formulas, overlays, diagnostics (sole owner)        |
| [`razavi-visual-contract.md`](razavi-visual-contract.md)           | Razavi authority, construction, exposure, pixel fidelity (sole owner)  |
| [`names-and-labels.md`](names-and-labels.md)                       | Electrical names vs label display, standard looks, renames             |
| [`agent-api.md`](agent-api.md)                                     | Agent API 3.0 Circuit operations and sibling resources                 |
| [`web-agent-session.md`](web-agent-session.md)                     | Agent relay: pairing, credentials, transport, scopes                   |
| [`persistence-and-recovery.md`](persistence-and-recovery.md)       | Cloud Save, browser recovery, workspace, desktop files                 |
| [`export.md`](export.md)                                           | Formal SVG/PNG/PDF                                                     |
| [`netlist-export.md`](netlist-export.md)                           | Extraction, SPICE/Spectre printing, refusals (sole owner)              |
| [`netlist-conversion.md`](netlist-conversion.md)                   | SPICE/SCS conversion protocol and import boundary                      |
| [`rnl-interchange.md`](rnl-interchange.md)                         | RNL export formats and import (proposed)                               |
| [`performance.md`](performance.md)                                 | Benchmark workloads and release budgets                                |
| [`editor-interaction.md`](editor-interaction.md)                   | Gestures, selection, previews, controls (sole owner)                   |
| [`community-gallery.md`](community-gallery.md)                     | Gallery feed, accounts, moderation                                     |
| [`analog-arena.md`](analog-arena.md)                               | Contract with the AnalogArena Worker (cross-repo)                      |

## Writing a spec

All specs are `accepted`. Add one only for a stable cross-module contract, from
[`spec.template.md`](spec.template.md): `pnpm docs:check` checks status
(`accepted`/`proposed`), owner and that `Version:` appears only for an
independently versioned protocol. When code disagrees with a spec, check
behavior and consequences before choosing which side to fix.
