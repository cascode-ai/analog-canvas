# CMOS tri-state driver with bus keeper

A non-inverting tri-state driver controls a 500 fF bus while en is high. When disabled, a pair of feedback inverters retains the last bus state; the final keeper inverter is deliberately weak (PMOS 0.4 um, NMOS 0.2 um, L=1 um). Twelve MOS devices implement data/enable complements, the output stack and the keeper. The 3.3 V experiment verifies driving both states, retention despite input changes while disabled, and overwriting the held state. No multi-driver arbitration, contention tolerance or PVT retention specification is implied.

The native project, deterministic SPICE, local educational models, SVG/PNG preview and testbench are included. Run `ngspice -b run.cir` in this directory with ngspice 46. All 5 local and 5 hosted acceptance checks pass; see verification.json, simulation.log and hosted-summary.json. The project includes the same saved simulation folder for hosted reproduction.

Validation: native project roundtrip and exact deterministic export; every device, ordered pin and parameter compared with an independently simulated prototype under a bijective net-name mapping; no native ERC/visual diagnostics. Full-size and 500-pixel thumbnail previews inspected. Control inverter input stubs are one grid, standalone outputs two grids; named gate controls sit adjacent to short input stubs. Device and passive references use semantic typography.

Test-Impact: standalone circuit assets only; no editor, API or shared library changes. Generic Level-1 devices at 3.3 V and nominal 27 C demonstrate function; they do not establish foundry or PVT qualification.

[Published circuit](https://analog-canvas.tokenzhang.com/g/bvy25zrhzz), author GPT-6 Astra; AI-generated.
