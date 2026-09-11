# Current Product Architecture

Analog Canvas is a local-first schematic editor with structural netlist
interchange and analog simulation orchestration. Humans and authorized Agents
work on the same live Project through typed, revision-checked operations. The
product does not implement a new numerical solver or a general-purpose remote
execution service.

## Product boundary

The editor supports hierarchical circuit authoring, structural SPICE import,
private Cloud Projects, portable `.icproj.json`, vector/raster publication, and
deterministic SPICE/Spectre design-netlist export. The simulation workspace
prepares authored structured or raw input, runs it in a configured environment,
and presents numeric results and bounded execution evidence.

A Project persists circuit facts and named simulation setups, including raw
authored files when selected. It does not persist simulator processes, prepared
decks, run receipts, or numeric results. Browser recovery and managed execution
retention serve different lifecycles; neither is another source of circuit facts.
Preview and Production availability follow [deployment](deployment.md).

## Sources of truth

| Concern                                          | Authority                                                                        |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| Circuit facts and authored simulation setups     | Current Project schema in `@icm/model`                                           |
| Formal save                                      | Stable private Cloud Project ID and optimistic revision                          |
| Portable file compatibility                      | Parse/upgrade/serialize boundary in `@icm/project-protocol`                      |
| Device semantics and parameters                  | Descriptor registry in `@icm/devices`                                            |
| Human and Agent Project mutations                | `@icm/edit-engine` transactions                                                  |
| Symbol geometry and pin anchors                  | `@icm/symbols`                                                                   |
| Visual construction and acceptance               | Razavi reference manifest and [visual contract](specs/razavi-visual-contract.md) |
| Electrical read model                            | `@icm/derived` Base-Net/Logical-Net projections and connectivity index           |
| Structural SPICE import                          | `@icm/spice` transient Circuit IR                                                |
| Design-netlist export and structured compilation | `@icm/netlist`                                                                   |
| Preparation and session-facing execution         | `@icm/simulation-service`                                                        |
| Simulator evidence and result parsing            | `@icm/spice-run` and the configured executor                                     |
| Hosted admission and bounded retention           | Worker managed control plane and artifact store                                  |
| Browser authorization and transport              | [Web-session contract](specs/web-agent-session.md)                               |

## System shape

```text
human UI / authorized Agent
  ├─ typed Project edits → Edit Engine → Project / Documents / setups
  │                                      ├─ connectivity / checks / navigation
  │                                      ├─ rendering / formal image export
  │                                      ├─ structural netlist export
  │                                      └─ Cloud Save / portable interchange
  └─ prepare / run / read / cancel
       → SimulationService ← immutable snapshot of selected authored input
       → configured executor / managed admission → ngspice + qualified models
       → parsed results / artifacts → UI and Agent
```

The simulation path reads circuit facts; it does not rewrite a Net or source
Instance from a result. Testbench bias and waveform parameters remain on ordinary
Instances. Analyses and outputs belong to the selected setup, not a second
source-value override.

## Core invariants

- A Base Net owns physical membership. Net Labels, VDD, Ground, and Power Rail
  naming use one owner-addressed marker system; Logical Nets are derived.
  Power Rail is a drawing gesture, not a separate electrical object.
- Different supply names remain distinct. Scope and hierarchy interfaces
  determine where a name connects; text equality alone is not a universal
  cross-Cell connection rule.
- A Crossing is not a Junction. Explicit connect/snap operations update topology;
  arbitrary visual overlap does not authorize a connection.
- Movement preserves established connectivity through the common routing plan;
  explicit cut partitions physical connectivity.
- Cell Pins are ordered hierarchy interfaces. Visual variants never delete
  electrical terminal semantics or invent MOS bulk connections.
- Canonical Project content is schema-49, governed by the
  [file-format contract](specs/project-file-format.md).
  Cloud Save, portable file export, browser recovery, and public Gallery
  publication are distinct operations.
- The author owns the Testbench. Native primitives and models supported by the
  selected environment can run; unresolved or unsupported devices produce
  located diagnostics rather than guessed replacements.
- Circuit operations, File resources, Project management, and simulation share
  authorization boundaries without becoming competing mutation protocols.
- Electrical checks, publication advice, and execution acceptance are different
  decisions. A successful save, pretty drawing, or exit code alone does not
  establish electrical correctness.

## Read next

- [User workflows](user/getting-started.md) and [analog simulation](user/analog-simulation.md).
- [Normative contracts](specs/README.md) and [architectural rationale](adr/README.md).
- [Agent workflow](agent/workflow.md).
- [Remaining work](roadmap/README.md).
