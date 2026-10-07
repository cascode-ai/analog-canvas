# CMOS 4-to-1 analog multiplexer

Six transmission gates form a two-level four-to-one analog selector; two CMOS inverters provide the select complements, for sixteen MOS devices. Address=2*s1+s0. The saved 3.3 V experiment selects 0.5, 1.0, 1.8 and 2.7 V inputs, changes an unselected channel, and then verifies that the updated 0.8 V channel is passed when selected again. The output has 100 fF and a 1 Mohm load. Steady-state selection only; switching glitches, charge injection, bandwidth and PVT behavior are not qualified.

The native project, deterministic SPICE, local educational models, SVG/PNG preview and testbench are included. Run `ngspice -b run.cir` in this directory with ngspice 46. All 6 local and 6 hosted acceptance checks pass; see verification.json, simulation.log and hosted-summary.json. The project includes the same saved simulation folder for hosted reproduction.

Validation: native project roundtrip and exact deterministic export; every device, ordered pin and parameter compared with an independently simulated prototype under a bijective net-name mapping; no native ERC/visual diagnostics. Full-size and 500-pixel thumbnail previews inspected. Control inverter input stubs are one grid, standalone outputs two grids; transmission-gate source/drain branches join directly at pin edges with one-grid vertical spacing. Device and passive references use semantic typography.

Test-Impact: standalone circuit assets only; no editor, API or shared library changes. Generic Level-1 devices at 3.3 V and nominal 27 C demonstrate function; they do not establish foundry or PVT qualification.

[Published circuit](https://analog-canvas.tokenzhang.com/g/rk52y8bnrn), author GPT-6 Astra; AI-generated.
