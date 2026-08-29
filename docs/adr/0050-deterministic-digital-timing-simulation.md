# ADR 0050: Deterministic digital timing simulation is a separate layer

Status: `accepted`

Date: `2026-08-28`

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
JSON. The local development editor exposes timing controls, waveform
presentation and export, optional canvas placement, and Pulse Source authoring
behind `VITE_ICM_TIMING_UI`. The default is enabled for local development and
disabled for production; the Cloudflare workflow also sets `disabled`
explicitly. The simulation layer and project compatibility never depend on
this presentation flag.

Razavi Figure 20.54 governs presentation only: stacked square traces, signal
labels, dashed timing guides, and a horizontal time axis. It cannot establish
logic values, event ordering, or clock semantics.

## Consequences

- Identical Document/profile inputs produce identical traces.
- The simulation layer can grow without making the editor or netlist exporter
  its execution engine.
- Existing projects containing Pulse Sources remain loadable in every build;
  the local development palette also supports authoring new Pulse Sources.
- An unused DFF `QBAR` output may remain unconnected; `D`, `CK`, and `Q` remain
  required for the supported rising-edge behavior.
- Gate delay, setup/hold timing, metastability, hierarchy, and analog threshold
  conversion remain out of scope for this first block.

## Validation

- Unit tests cover four-state logic, Pulse-to-gate propagation, DFF division,
  optional `QBAR`, and logical-Net equivalence.
- Device and netlist tests cover the two-terminal Pulse Source defaults and
  SPICE/Spectre `PULSE` output.
- Editor and browser tests cover the local timing controls and Pulse Source;
  flag tests and the deployment workflow protect the production-hidden state.

## Related documents

- [Digital timing simulation specification](../specs/digital-timing-simulation.md)
- [Deterministic netlist export](../specs/netlist-export.md)
