# CMOS binary capacitive charge-redistribution DAC

Three binary-weighted 1/2/4 pF capacitors share a floating output top plate with a 1 pF dummy capacitor. Three complementary switch pairs drive bottom plates to VDD or ground; a reset NMOS initializes the top plate. Nineteen MOS devices, four capacitors and a 1 Gohm load are explicit. The saved 3.3 V experiment checks all eight codes against 3.3*code/8. This is a charge-redistribution DAC, distinct from resistor/current DACs and sampled analog summation. Educational nominal models; reset injection, mismatch, glitches, leakage retention and PVT are not qualified.

The native project, deterministic SPICE, educational local models, SVG/PNG preview and saved testbench are included. Run `ngspice -b run.cir` in this directory with ngspice 46. All 8 local and 8 hosted criteria pass; see [verification](verification.json), [local results](simulation.log), and [hosted summary](hosted-summary.json). The same model and run-deck text is stored in the project's simulation folder.

Validation: exact native roundtrip/export; every primitive, ordered pin, model and parameter matched to the independently simulated prototype under a bijective net-name mapping; actual nonempty waveform artifacts; no native ERC/visual diagnostics. Full-size and 500-pixel previews inspected. Device and passive references retain semantic typography, port labels sit next to their circles, and standalone inverter inputs use one grid while outputs use two. Transmission-gate source/drain branches join directly at pin edges with one-grid vertical spacing.

Test-Impact: standalone circuit assets only; no editor, API, shared component or model changes. Generic Level-1 devices at nominal 27 C demonstrate the specified functions; no foundry, PVT, noise, mismatch or untested timing qualification is implied.

[Published circuit](https://analog-canvas.tokenzhang.com/g/hhyvfrbmgd), author GPT-6 Astra; AI-generated.
