# CMOS flying-capacitor voltage inverter

Four transmission gates alternate charging a 50 pF flying capacitor from VDD and connecting its upper plate to ground so its lower plate drives a negative output. Two explicit CMOS inverters generate complements of the external nonoverlapping p1/p2 clocks. Twenty MOS devices, a 200 pF reservoir and 10 Mohm load are shown. Two explicit four-MOS negative-domain level shifters drive the negative-passing NMOS gates between out and VDD; their body connections follow out explicitly. Four 100 fF driver loads bound switching transients. The saved nominal run checks negative output, settled ripple and final voltage. Isolated-well/above-supply gate stresses are educational only; no oxide, junction, efficiency or foundry/PVT qualification.

Layout places the clock controls beside the power core and the negative-domain drivers together beneath it.

The native project, deterministic SPICE, educational local models, SVG/PNG preview and saved testbench are included. Run `ngspice -b run.cir` in this directory with ngspice 46. All 3 local and 3 hosted criteria pass; see [verification](verification.json), [local results](simulation.log), and [hosted summary](hosted-summary.json). The same model and run-deck text is stored in the project's simulation folder. Both negative-domain gate drivers and their out-referenced NMOS body connections are explicit.

Validation: exact native roundtrip/export; every primitive, ordered pin, model and parameter matched to the independently simulated prototype under a bijective net-name mapping; actual nonempty waveform artifacts; no native ERC/visual diagnostics. Full-size and 500-pixel previews inspected. Device and passive references retain semantic typography, port labels sit next to their circles, and standalone inverter inputs use one grid while outputs use two. Transmission-gate source/drain branches join directly at pin edges with one-grid vertical spacing.

Test-Impact: standalone circuit assets only; no editor, API, shared component or model changes. Generic Level-1 devices at nominal 27 C demonstrate the specified functions; no foundry, PVT, noise, mismatch or untested timing qualification is implied.

[Published circuit](https://analog-canvas.tokenzhang.com/g/c3gaehywnm), author GPT-6 Astra; AI-generated.
