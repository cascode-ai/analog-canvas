# CMOS 2-bit current-steering DAC

An 11-MOS two-bit DAC steers binary-weighted NMOS mirror currents into complementary 22 kohm loads. A 10 uA external reference sets nominal 10 uA and 20 uA legs; two CMOS inverters generate bit complements. The output voltage falls as code=2*d1+d0 rises. All four codes are checked using the resistor-derived sink current, along with the complementary-current sum. Generic Level-1 nominal demonstration; current-source output resistance causes finite gain error. No INL/DNL, glitch, matching, settling-time or foundry qualification is claimed.

The native project, deterministic SPICE, local educational models, SVG/PNG preview and testbench are included. Run `ngspice -b run.cir` in this directory with ngspice 46. All 8 local and 8 hosted acceptance checks pass; see verification.json, simulation.log and hosted-summary.json. The project includes the same saved simulation folder for hosted reproduction.

Validation: native project roundtrip and exact deterministic export; every device, ordered pin and parameter compared with an independently simulated prototype under a bijective net-name mapping; no native ERC/visual diagnostics. Full-size and 500-pixel thumbnail previews inspected. Control inverter input stubs are one grid, standalone outputs two grids; named gate controls sit adjacent to short input stubs. Device and passive references use semantic typography.

Test-Impact: standalone circuit assets only; no editor, API or shared library changes. Generic Level-1 devices at 3.3 V and nominal 27 C demonstrate function; they do not establish foundry or PVT qualification.

[Published circuit](https://analog-canvas.tokenzhang.com/g/wdy4zjh3ad), author GPT-6 Astra; AI-generated.
