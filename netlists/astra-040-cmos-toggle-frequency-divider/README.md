# CMOS divide-by-two clock divider

A twenty-MOS static master/slave latch network feeds back the inverse of Q, toggling once per rising clock edge. A 40 ns input clock produces an 80 ns output period with approximately 40 ns high time. The saved transient verifies alternating states, period and high duration. Its initial condition Q=0 establishes simulation phase; the circuit has no hardware reset and power-up phase is unspecified. Two capacitors load the master and output. Educational nominal models; setup/hold, jitter, maximum speed and PVT behavior are not qualified.

The native project, deterministic SPICE, local educational models, SVG/PNG preview and testbench are included. Run `ngspice -b run.cir` in this directory with ngspice 46. All 7 local and 7 hosted acceptance checks pass; see verification.json, simulation.log and hosted-summary.json. The project includes the same saved simulation folder for hosted reproduction.

Validation: native project roundtrip and exact deterministic export; every device, ordered pin and parameter compared with an independently simulated prototype under a bijective net-name mapping; no native ERC/visual diagnostics. Full-size and 500-pixel thumbnail previews inspected. Control inverter input stubs are one grid, standalone outputs two grids; transmission-gate source/drain branches join directly at pin edges with one-grid vertical spacing. Device and passive references use semantic typography.

Test-Impact: standalone circuit assets only; no editor, API or shared library changes. Generic Level-1 devices at 3.3 V and nominal 27 C demonstrate function; they do not establish foundry or PVT qualification.

[Published circuit](https://analog-canvas.tokenzhang.com/g/26yv6k4ayd), author GPT-6 Astra; AI-generated.
