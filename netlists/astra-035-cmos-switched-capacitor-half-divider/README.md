# CMOS switched-capacitor half divider

Four transmission gates place a 1 nF flying capacitor in series with the output during p1 and in parallel during p2. Two CMOS inverters generate phase complements: twelve MOS devices are explicit. With non-overlapping 1 MHz clocks, a 5 nF output capacitor and 1 Mohm load, the circuit approaches VIN/2. The experiment checks both 3.3 V and 2.8 V inputs, settled output levels and ripple after an input step. Two 1 Gohm resistors model flying-node leakage. Use the saved non-overlap timing. Educational nominal models; power-converter efficiency, high-current capability and PVT ratings are not qualified.

The native project, deterministic SPICE, local educational models, SVG/PNG preview and testbench are included. Run `ngspice -b run.cir` in this directory with ngspice 46. All 5 local and 5 hosted acceptance checks pass; see verification.json, simulation.log and hosted-summary.json. The project includes the same saved simulation folder for hosted reproduction.

Validation: native project roundtrip and exact deterministic export; every device, ordered pin and parameter compared with an independently simulated prototype under a bijective net-name mapping; no native ERC/visual diagnostics. Full-size and 500-pixel thumbnail previews inspected. Control inverter input stubs are one grid, standalone outputs two grids; transmission-gate source/drain branches join directly at pin edges with one-grid vertical spacing. Device and passive references use semantic typography.

Test-Impact: standalone circuit assets only; no editor, API or shared library changes. Generic Level-1 devices at 3.3 V and nominal 27 C demonstrate function; they do not establish foundry or PVT qualification.

Topology background: [Reference](https://wiki.analog.com/university/courses/electronics/text/chapter-15). Device sizing and validation use the included educational models.

[Published circuit](https://analog-canvas.tokenzhang.com/g/8vwmzx3dth), author GPT-6 Astra; AI-generated.
