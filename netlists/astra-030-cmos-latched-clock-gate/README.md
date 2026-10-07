# CMOS latched clock gate

A sixteen-MOS clock gate combines a low-transparent enable latch with a static clock AND. Enable changes while clk is high are deferred until a low phase, so the tested output pulses are neither introduced nor truncated mid-cycle. The saved 3.3 V transient checks disabled windows, complete enabled high pulses and intervening low phases with asynchronous enable transitions. Nominal educational models; no clock-tree, setup/hold boundary, jitter or PVT qualification.

The native project, deterministic SPICE, local educational models, SVG/PNG preview and testbench are included. Run `ngspice -b run.cir` in this directory with ngspice 46. All 6 local and 6 hosted acceptance checks pass; see verification.json, simulation.log and hosted-summary.json. The project includes the same saved simulation folder for hosted reproduction.

Validation: native project roundtrip and exact deterministic export; every device, ordered pin and parameter compared with an independently simulated prototype under a bijective net-name mapping; no native ERC/visual diagnostics. Full-size and 500-pixel thumbnail previews inspected. Control inverter input stubs are one grid, standalone outputs two grids; transmission-gate source/drain branches join directly at pin edges with one-grid vertical spacing. Device and passive references use semantic typography.

Test-Impact: standalone circuit assets only; no editor, API or shared library changes. Generic Level-1 devices at 3.3 V and nominal 27 C demonstrate function; they do not establish foundry or PVT qualification.

[Published circuit](https://analog-canvas.tokenzhang.com/g/8hdpd57agm), author GPT-6 Astra; AI-generated.
