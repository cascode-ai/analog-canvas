# Digital timing simulation

`@icm/simulation` is the deterministic digital event layer. It reads a current
`SchematicDocument` and a run profile; it never mutates either one.

The first supported set is:

- two-terminal Digital Clock (`pulse-voltage-source`) referenced to Ground;
- Buffer, inverter, AND, OR, NAND, NOR, XOR, and XNOR;
- rising-edge `d-flip-flop`; and
- four-state `0`, `1`, `X`, and `Z` driver resolution.

Simulation time is an integer number of picoseconds. Saved Net IDs select
traces to return; they do not change circuit connectivity. Browser run results
are intentionally temporary. Every editor build exposes Digital Clock
authoring and one Digital Simulation window for setup, saved Nets, waveform
viewing and export, and optional canvas placement.

This package does not model analog thresholds, propagation delay, setup/hold
windows, metastability, or transistor-level behavior.
