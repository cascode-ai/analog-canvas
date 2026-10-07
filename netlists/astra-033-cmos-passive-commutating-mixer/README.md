# CMOS differential commutating mixer

Four transmission gates alternately pass and reverse a differential input; a CMOS inverter generates the complementary LO. Ten MOS devices, two 40 kohm loads referenced to 1.65 V and two 100 fF capacitors are explicit. The saved experiment mixes a 1.1 MHz, 200 mV differential input with a 1 MHz square-wave LO. Coherent 100 kHz quadrature averages check the translated component, with DC and unconverted-RF rejection checks. The output also contains switching harmonics and needs filtering in an application. Educational Level-1 nominal behavior; no noise, linearity, RF parasitic or PVT qualification.

The native project, deterministic SPICE, local educational models, SVG/PNG preview and testbench are included. Run `ngspice -b run.cir` in this directory with ngspice 46. All 4 local and 4 hosted acceptance checks pass; see verification.json, simulation.log and hosted-summary.json. The project includes the same saved simulation folder for hosted reproduction.

Validation: native project roundtrip and exact deterministic export; every device, ordered pin and parameter compared with an independently simulated prototype under a bijective net-name mapping; no native ERC/visual diagnostics. Full-size and 500-pixel thumbnail previews inspected. Control inverter input stubs are one grid, standalone outputs two grids; transmission-gate source/drain branches join directly at pin edges with one-grid vertical spacing. Device and passive references use semantic typography.

Test-Impact: standalone circuit assets only; no editor, API or shared library changes. Generic Level-1 devices at 3.3 V and nominal 27 C demonstrate function; they do not establish foundry or PVT qualification.

[Published circuit](https://analog-canvas.tokenzhang.com/g/vnzhpfjz84), author GPT-6 Astra; AI-generated.
