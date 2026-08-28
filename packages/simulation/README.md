# Digital timing simulation

`@icm/simulation` is the deterministic digital event layer. It reads a current
`SchematicDocument` and a run profile; it never mutates either one.

The first supported set is:

- two-terminal `pulse-voltage-source` referenced to Ground;
- Buffer, inverter, AND, OR, NAND, NOR, XOR, and XNOR;
- rising-edge `d-flip-flop`; and
- four-state `0`, `1`, `X`, and `Z` driver resolution.

Simulation time is an integer number of picoseconds. Saved Net IDs select
traces to return; they do not change circuit connectivity. Browser run results
are intentionally temporary. The local development editor exposes the timing
panel, waveform export, optional canvas placement, and Pulse Source authoring;
Cloudflare production builds explicitly keep that experimental UI hidden.
The simulation package and project compatibility do not depend on the UI flag.

This package does not model analog thresholds, propagation delay, setup/hold
windows, metastability, or transistor-level behavior.
