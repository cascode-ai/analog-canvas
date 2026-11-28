# Current Product Architecture

A local-first schematic editor with netlist interchange and simulation
orchestration; humans and Agents edit one live Project through typed,
revision-checked operations. A Project persists circuit facts and simulation
source folders, never processes, prepared decks, receipts or results.

## Sources of truth

| Concern                                       | Authority                                                                        |
| --------------------------------------------- | -------------------------------------------------------------------------------- |
| Circuit facts and authored simulation folders | Current Project schema in `@icm/model`                                           |
| Formal save                                   | Stable private Cloud Project ID and optimistic revision                          |
| Portable file compatibility                   | Parse/upgrade/serialize boundary in `@icm/project-protocol`                      |
| Device semantics and parameters               | Component definition `electrical` section, projected into `@icm/devices`         |
| Human and Agent Project mutations             | `@icm/edit-engine` transactions                                                  |
| Symbol geometry and pin anchors               | Component definition `symbol` section, projected into `@icm/symbols`             |
| Visual construction and acceptance            | Razavi reference manifest and [visual contract](specs/razavi-visual-contract.md) |
| Electrical read model                         | `@icm/derived` Base-Net/Logical-Net projections and connectivity index           |
| Structural SPICE import                       | `@icm/spice` transient Circuit IR                                                |
| Design-netlist export and source compilation  | `@icm/netlist`                                                                   |
| Preparation and session-facing execution      | `@icm/simulation-service`                                                        |
| Simulator evidence and result parsing         | `@icm/spice-run` and the configured executor                                     |
| Hosted admission and bounded retention        | Worker managed control plane and artifact store                                  |
| Browser authorization and transport           | [Web-session contract](specs/web-agent-session.md)                               |

## System shape

```text
human UI / authorized Agent
  ├─ typed Project edits → Edit Engine → Project / Documents / source folders
  │                                      ├─ connectivity / checks / navigation
  │                                      ├─ rendering / formal image export
  │                                      ├─ structural netlist export
  │                                      └─ Cloud Save / portable interchange
  └─ prepare / run / read / cancel
       → SimulationService ← immutable snapshot of selected authored input
       → configured executor / managed admission
       → ngspice + qualified models
       → parsed results / artifacts → UI and Agent
```

## Core invariants

- A Base Net owns physical membership; Logical Nets are derived. Net Labels,
  Ground, Global VDD and Power Rail naming share one owner-addressed marker
  system (local VDD Power uses the Cell-Pin owner); Power Rail is only a
  drawing gesture.
- Different supply names stay distinct; scope and hierarchy interfaces, not
  text equality, decide where a name connects.
- A Crossing is not a Junction: only explicit connect/snap changes topology.
  Movement preserves connectivity; explicit cut partitions it.
- Cell Pins are ordered interfaces; visual variants never drop terminals or
  invent MOS bulk connections.
- Runtime and portable schema versions follow the
  [file-format contract](specs/project-file-format.md). Cloud Save, portable
  export, browser recovery and Gallery publication are distinct operations.
- The author owns the Testbench; unsupported devices get located diagnostics,
  never guessed replacements.
- Circuit, File, Project and simulation operations share authorization without
  becoming competing mutation protocols.
- A save, a pretty drawing or an exit code does not establish electrical
  correctness.
