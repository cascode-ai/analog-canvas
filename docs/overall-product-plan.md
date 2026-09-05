# Current Product Architecture

Analog Canvas is a local-first schematic editor. A human edits a circuit in the
browser, while an authorized Agent may inspect and modify the same live Project
through typed, revision-checked requests. The product is an editor and a
structural circuit tool; it is not a simulator, version-control service, or
general browser-automation service.

## Product boundary

The editor accepts structural SPICE input, manual component placement, wires,
text, and limited drawing annotations. It saves private Cloud Projects,
imports/exports canonical `.icproj.json`, exports SVG/PNG/PDF, and can create deterministic
structural SPICE or Spectre design netlists once all required design facts are
explicit. Source SPICE, simulation decks, PDK setup, analyses, and browser
recovery copies are not authoritative Project data.

The authoritative sources are deliberately separate:

| Concern                              | Authority                                                                        |
| ------------------------------------ | -------------------------------------------------------------------------------- |
| Persisted circuit facts              | Current Project schema in `@icm/model`                                           |
| Formal Project persistence           | Stable private Cloud Project id plus optimistic revision                         |
| Portable file compatibility          | Bounded parse/migrate/serialize boundary in `@icm/project-protocol`              |
| Built-in device facts                | Single descriptor registry in `@icm/devices`                                     |
| Human and Agent mutations            | `@icm/edit-engine` transactions                                                  |
| Built-in device electrical semantics | `@icm/devices`                                                                   |
| Symbol artwork and pin anchors       | `@icm/symbols`                                                                   |
| Visual construction and acceptance   | Razavi reference manifest and [visual contract](specs/razavi-visual-contract.md) |
| SPICE import                         | `@icm/spice` transient Circuit IR                                                |
| Design-netlist export                | `@icm/netlist` transient DesignNetlistIR                                         |
| Browser Agent session                | accepted [web-session spec](specs/web-agent-session.md)                          |

## System shape

```text
human UI / authorized Agent
            │ typed, revision-checked edits
            ▼
      Schematic Edit Engine
            │ validates and atomically applies
            ▼
       Project and Document model
        ├─ derived connectivity and diagnostics
        ├─ SVG/PNG/PDF formal export
        ├─ structural SPICE/Spectre export
        └─ explicit Cloud Save / portable Project interchange
```

Both actors use the same edit engine. The UI is responsible for interaction,
file choice, and presentation; the Agent transport is responsible only for
scoped authentication and forwarding. Neither can bypass electrical,
revision, lock, or transaction invariants.

## Core invariants

- Net membership, explicit Junctions, formal cell terminals, and typed Instance
  terminals are
  electrical facts; drawing geometry never silently creates a connection.
- A Crossing is not a Junction. Ambiguous intersections are rejected rather
  than guessed.
- A Base Net owns physical membership only. Net Label, VDD, Ground,
  and Power Rail naming all enter one owner-addressed marker system and resolve
  to one derived Logical-Net view used by ERC, export, search, highlight, and
  Agent snapshots. Power Rail is a drawing gesture, not another power object.
- VDD, AVDD, DVDD, and Ground node `0` are ordinary global marker names;
  different names remain electrically distinct. Cell Pins remain the
  ordered hierarchy interface rather than another Net-label mechanism.
- Routes describe visible geometry; they may stretch locally during movement
  without changing logical connectivity.
- A Project's canonical content is schema-38 JSON. Explicit Save updates one
  stable private Cloud Project; `.icproj.json` is portable interchange, and
  browser recovery is an origin-local, non-authoritative copy.
- Visual variants may change presentation but never remove electrical terminal
  semantics. The Razavi raster manifest is the sole visual authority.
- An Agent reads a complete Snapshot, submits typed edits with an expected
  revision, and refreshes after a conflict. It does not infer a second command
  language or mutate through DOM automation.

## Where to read next

- User workflows and limits: [user guides](user/getting-started.md).
- Stable behavior: [normative specifications](specs/README.md).
- Why shared boundaries exist: [architecture decisions](adr/README.md).
- How an Agent should operate: [Agent workflow](agent/workflow.md).
- Remaining cross-module work: [roadmap](roadmap/README.md).
