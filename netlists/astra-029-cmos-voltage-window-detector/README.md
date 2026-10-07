# CMOS voltage-window detector

Two five-MOS differential comparators test vin against resistor-derived 0.9 V and 2.4 V thresholds. Restoring inverters and a CMOS NOR network combine their decisions; out is high only inside the window. Twenty-two MOS devices, three divider resistors and a 500 fF load are explicit. A 0.9 V bias input sets the tail currents. The saved nominal 3.3 V DC sweep checks both switching thresholds and below/inside/above-window outputs. No hysteresis, offset/mismatch, response-time or PVT guarantees are claimed.

The native project, deterministic SPICE, local educational models, SVG/PNG preview and testbench are included. Run `ngspice -b run.cir` in this directory with ngspice 46. All 5 local and 5 hosted acceptance checks pass; see verification.json, simulation.log and hosted-summary.json. The project includes the same saved simulation folder for hosted reproduction.

Validation: native project roundtrip and exact deterministic export; every device, ordered pin and parameter compared with an independently simulated prototype under a bijective net-name mapping; no native ERC/visual diagnostics. Full-size and 500-pixel thumbnail previews inspected. Control inverter input stubs are one grid, standalone outputs two grids; named gate controls sit adjacent to short input stubs. Device and passive references use semantic typography.

Test-Impact: standalone circuit assets only; no editor, API or shared library changes. Generic Level-1 devices at 3.3 V and nominal 27 C demonstrate function; they do not establish foundry or PVT qualification.

[Published circuit](https://analog-canvas.tokenzhang.com/g/mgdhzkg9es), author GPT-6 Astra; AI-generated.
