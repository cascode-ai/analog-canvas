# ADR 0049: Deterministic digital timing simulation is a separate layer

Status: `accepted`

Date: `2026-08-28`

Amended: `2026-08-29` to publish the accepted interaction in every editor
build after its release gates passed.

Owners: `packages/simulation`, `packages/devices`, `packages/netlist`

## Context

The editor can already author sequential logic symbols, but schematic editing,
analog netlist export, and browser presentation do not provide a clocked
digital execution model. Treating waveform pixels as simulation data would
couple electrical behavior to a textbook image and would make results hard to
test. Persisting every run in Project JSON would also turn derived, stale data
into authored circuit state.

## Decision

`@icm/simulation` is a separate deterministic event layer over the current
`SchematicDocument`. It extracts logical Nets through the derived connectivity
model and supports four-state values, driven-net resolution, combinational
delta-cycle settling, two-terminal Pulse Sources, and rising-edge D flip-flop
capture. Time is represented as integer picoseconds.

The first supported block is deliberately small: Pulse Source, inverter,
Buffer, two-input logic gates, and a D flip-flop. Unsupported components emit a
diagnostic instead of acquiring guessed behavior. A Pulse Source's negative
terminal must connect to Ground; its positive terminal drives the logical Net.

Saved nodes are observation selections in the run profile, not electrical
probes. Simulation results remain derived data and are not stored in Project
JSON. Every editor build exposes Digital Clock authoring and one Digital
Simulation window containing timing controls, saved-Net selection, waveform
presentation and export, and optional canvas placement. Production and local
builds use the same interaction path; there is no deployment-specific timing
UI flag.

Razavi Figure 20.54 governs presentation only: stacked square traces, signal
labels, dashed timing guides, and a horizontal time axis. It cannot establish
logic values, event ordering, or clock semantics.

## Consequences

- Identical Document/profile inputs produce identical traces.
- The simulation layer can grow without making the editor or netlist exporter
  its execution engine.
- Existing projects containing Pulse Sources remain loadable in every build;
  every editor palette supports authoring new Digital Clocks.
- An unused DFF `QBAR` output may remain unconnected; `D`, `CK`, and `Q` remain
  required for the supported rising-edge behavior.
- Gate delay, setup/hold timing, metastability, hierarchy, and analog threshold
  conversion remain out of scope for this first block.

## Validation

- Unit tests cover four-state logic, Pulse-to-gate propagation, DFF division,
  optional `QBAR`, and logical-Net equivalence.
- Device and netlist tests cover the two-terminal Pulse Source defaults and
  SPICE/Spectre `PULSE` output.
- Editor and browser tests cover the shared timing controls, Digital Clock,
  waveform export, and optional canvas placement used by every deployment.
