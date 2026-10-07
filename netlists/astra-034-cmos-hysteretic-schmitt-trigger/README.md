# CMOS hysteretic Schmitt trigger

A six-MOS feedback inverter stack and two output inverters form a ten-MOS inverting Schmitt trigger. Complementary feedback changes the switching threshold according to the current state. A slow 0-to-3.3-to-0 V input ramp measures rising-input and falling-input thresholds and verifies the rail states. The two thresholds demonstrate nominal hysteresis. Generic Level-1 educational models; noise immunity, metastability, propagation delay and PVT limits are not qualified.

The native project, deterministic SPICE, local educational models, SVG/PNG preview and testbench are included. Run `ngspice -b run.cir` in this directory with ngspice 46. All 7 local and 7 hosted acceptance checks pass; see verification.json, simulation.log and hosted-summary.json. The project includes the same saved simulation folder for hosted reproduction.

Validation: native project roundtrip and exact deterministic export; every device, ordered pin and parameter compared with an independently simulated prototype under a bijective net-name mapping; no native ERC/visual diagnostics. Full-size and 500-pixel thumbnail previews inspected. Control inverter input stubs are one grid, standalone outputs two grids; named gate controls sit adjacent to short input stubs. Device and passive references use semantic typography.

Test-Impact: standalone circuit assets only; no editor, API or shared library changes. Generic Level-1 devices at 3.3 V and nominal 27 C demonstrate function; they do not establish foundry or PVT qualification.

Topology background: [Reference](https://arxiv.org/abs/2006.08319). Device sizing and validation use the included educational models.

[Published circuit](https://analog-canvas.tokenzhang.com/g/4eeva6dj4a), author GPT-6 Astra; AI-generated.
