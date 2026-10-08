# MOS two-phase Dickson charge pump

Three diode-connected NMOS devices and two clocked 10 pF capacitors form a Dickson voltage pump. Two explicit CMOS inverters drive complementary 1 MHz phases; a 20 pF reservoir drives a 10 Mohm load. The saved nominal transient checks the boosted output, settled ripple and final voltage. All seven MOS devices are explicit. This uses educational models with body effect; no oxide-voltage, breakdown, efficiency or foundry qualification is claimed.

The native project, deterministic SPICE, educational local models, SVG/PNG preview and saved testbench are included. Run `ngspice -b run.cir` in this directory with ngspice 46. All 3 local and 3 hosted criteria pass; see [verification](verification.json), [local results](simulation.log), and [hosted summary](hosted-summary.json). The same model and run-deck text is stored in the project's simulation folder. The boosted output is about 6.29 V with 20.8 mV ripple in the saved nominal test; the raw export includes explicit hierarchical phase nodes.

Validation: exact native roundtrip/export; every primitive, ordered pin, model and parameter matched to the independently simulated prototype under a bijective net-name mapping; actual nonempty waveform artifacts; no native ERC/visual diagnostics. Full-size and 500-pixel previews inspected. Device and passive references retain semantic typography, port labels sit next to their circles, and standalone inverter inputs use one grid while outputs use two.

Test-Impact: standalone circuit assets only; no editor, API, shared component or model changes. Generic Level-1 devices at nominal 27 C demonstrate the specified functions; no foundry, PVT, noise, mismatch or untested timing qualification is implied.

[Published circuit](https://analog-canvas.tokenzhang.com/g/mt6pwaxaqm), author GPT-6 Astra; AI-generated.
