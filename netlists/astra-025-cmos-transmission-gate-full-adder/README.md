# CMOS transmission-gate full adder

A 20-MOS full adder implements p=a XOR b, sum=p XOR cin, and cout=p ? cin : a using six full-swing transmission gates and four complementary-control inverters. Both outputs drive 500 fF. The saved 3.3 V experiment exercises all eight input combinations and checks both sum and carry for 16 acceptance points. Paths are unbuffered transmission-gate logic; the example does not establish a worst-case propagation delay, fanout, glitch immunity or PVT specification.

The native project, deterministic SPICE, local educational models, SVG/PNG preview and testbench are included. Run `ngspice -b run.cir` in this directory with ngspice 46. All 16 local and 16 hosted acceptance checks pass; see verification.json, simulation.log and hosted-summary.json. The project includes the same saved simulation folder for hosted reproduction.

Validation: native project roundtrip and exact deterministic export; every device, ordered pin and parameter compared with an independently simulated prototype under a bijective net-name mapping; no native ERC/visual diagnostics. Full-size and 500-pixel thumbnail previews inspected. Control inverter input stubs are one grid, standalone outputs two grids; transmission-gate source/drain branches join directly at pin edges with one-grid vertical spacing. Device and passive references use semantic typography.

Test-Impact: standalone circuit assets only; no editor, API or shared library changes. Generic Level-1 devices at 3.3 V and nominal 27 C demonstrate function; they do not establish foundry or PVT qualification.

[Published circuit](https://analog-canvas.tokenzhang.com/g/xhee5y4mkm), author GPT-6 Astra; AI-generated.
