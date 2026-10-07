# CMOS 1.2 V to 3.3 V level shifter

A cross-coupled PMOS pair and two input-driven NMOS devices translate a 1.2 V logic input into a 3.3 V state. A low-rail inverter supplies the complementary input; two high-rail inverters buffer complementary outputs into 500 fF each. Ten MOS devices and two capacitors are explicit. The saved test verifies both output polarities over repeated low/high transitions. Generic Level-1 nominal behavior only: device stress, power sequencing, input overshoot and real process voltage ratings are not qualified.

The native project, deterministic SPICE, local educational models, SVG/PNG preview and testbench are included. Run `ngspice -b run.cir` in this directory with ngspice 46. All 10 local and 10 hosted acceptance checks pass; see verification.json, simulation.log and hosted-summary.json. The project includes the same saved simulation folder for hosted reproduction.

Validation: native project roundtrip and exact deterministic export; every device, ordered pin and parameter compared with an independently simulated prototype under a bijective net-name mapping; no native ERC/visual diagnostics. Full-size and 500-pixel thumbnail previews inspected. Control inverter input stubs are one grid, standalone outputs two grids; named gate controls sit adjacent to short input stubs. Device and passive references use semantic typography.

Test-Impact: standalone circuit assets only; no editor, API or shared library changes. Generic Level-1 devices at nominal 27 C (3.3 V main rail; the level shifter also uses a 1.2 V input rail) demonstrate function; they do not establish foundry or PVT qualification.

[Published circuit](https://analog-canvas.tokenzhang.com/g/bsjc9sctvh), author GPT-6 Astra; AI-generated.
