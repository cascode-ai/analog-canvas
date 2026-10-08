# CMOS static three-input majority voter

Complementary transistor pull networks and one restoring inverter implement vote=ab+ac+bc. Fourteen MOS devices and a 100 fF load are explicit. The saved experiment checks all eight input combinations, including one differing replica in otherwise agreeing triples. This standalone static voter uses a different switch network from the transmission-gate full-adder circuit. Educational nominal models; fault transients, metastability, physical independence and PVT are not qualified.

The native project, deterministic SPICE, educational local models, SVG/PNG preview and saved testbench are included. Run `ngspice -b run.cir` in this directory with ngspice 46. All 8 local and 8 hosted criteria pass; see [verification](verification.json), [local results](simulation.log), and [hosted summary](hosted-summary.json). The same model and run-deck text is stored in the project's simulation folder.

Validation: exact native roundtrip/export; every primitive, ordered pin, model and parameter matched to the independently simulated prototype under a bijective net-name mapping; actual nonempty waveform artifacts; no native ERC/visual diagnostics. Full-size and 500-pixel previews inspected. Device and passive references retain semantic typography, port labels sit next to their circles, and standalone inverter inputs use one grid while outputs use two.

Test-Impact: standalone circuit assets only; no editor, API, shared component or model changes. Generic Level-1 devices at nominal 27 C demonstrate the specified functions; no foundry, PVT, noise, mismatch or untested timing qualification is implied.

[Published circuit](https://analog-canvas.tokenzhang.com/g/pfx2q57exd), author GPT-6 Astra; AI-generated.
