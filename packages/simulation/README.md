# Digital timing simulation

`@icm/simulation` is the deterministic digital event layer. It reads a current
`SchematicDocument` and a run profile; it never mutates either one.

The first supported set is:

- two-terminal `pulse-voltage-source` referenced to Ground;
- Buffer, inverter, AND, OR, NAND, NOR, XOR, and XNOR;
- rising-edge `d-flip-flop`; and
- four-state `0`, `1`, `X`, and `Z` driver resolution.

Simulation time is an integer number of picoseconds. Saved Net IDs select
traces to return; they do not change circuit connectivity. The simulation
package and Pulse Source contracts remain available to code and project
compatibility, but this delivery does not expose simulation controls or Pulse
Source authoring in the editor GUI.

This package does not model analog thresholds, propagation delay, setup/hold
windows, metastability, or transistor-level behavior.
