# CMOS 3-bit R-2R DAC

Three complementary transmission-gate selectors drive a 3-bit R-2R resistor ladder. Three CMOS inverters generate complementary bit controls; all 18 MOS devices and ladder resistors are explicit. The 3.3 V rail is also the reference: ideal output is VDD times code/8. The saved experiment checks all eight codes into 1 Gohm and 100 fF. Finite switch resistance causes small code errors; no output buffer, calibration or precision specification is implied. Generic Level-1 models, nominal 27 C only.

The native project, deterministic SPICE, local educational models, SVG/PNG preview and testbench are included. Run `ngspice -b run.cir` in this directory with ngspice 46. All 8 local and 8 hosted acceptance checks pass; see verification.json, simulation.log and hosted-summary.json. The project includes the same saved simulation folder for hosted reproduction.

Validation: native project roundtrip and exact deterministic export; every device, ordered pin and parameter compared with an independently simulated prototype under a bijective net-name mapping; no native ERC/visual diagnostics. Full-size and 500-pixel thumbnail previews inspected. Control inverter input stubs are one grid, standalone outputs two grids; transmission-gate source/drain branches join directly at pin edges with one-grid vertical spacing. Device and passive references use semantic typography.

Test-Impact: standalone circuit assets only; no editor, API or shared library changes. Generic Level-1 devices at 3.3 V and nominal 27 C demonstrate function; they do not establish foundry or PVT qualification.

[Published circuit](https://analog-canvas.tokenzhang.com/g/r3exqm84h9), author GPT-6 Astra; AI-generated.

Compact layout revision: reduced redundant spacing between stages and control inverters, with 34.5% less SVG view-box area at unchanged symbol and font size. Facing transmission-gate controls on the same bit now share a physical wire and one label. Electrical files (circuit.spice, models.spice, run.cir) are byte-identical to 5f115451f; local functional checks were rerun and existing hosted evidence remains applicable.
