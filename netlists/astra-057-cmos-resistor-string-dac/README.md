# CMOS one-hot resistor-string DAC

Three 10 kohm resistors create four taps from 0 to 3.3 V. Four transmission gates, each with an explicit complement inverter, select one tap using external one-hot controls s0-s3. All sixteen MOS devices and the 100 fF/1 Gohm output load are explicit. The saved transient selects 0, 1.1, 2.2 and 3.3 V with a dead interval between selects and checks a return to zero. No binary decoder is hidden. Educational nominal models; simultaneous-select faults, tap accuracy, loading, glitch energy and PVT are not qualified.

The native project, deterministic SPICE, educational local models, SVG/PNG preview and saved testbench are included. Run `ngspice -b run.cir` in this directory with ngspice 46. All 5 local and 5 hosted criteria pass; see [verification](verification.json), [local results](simulation.log), and [hosted summary](hosted-summary.json). The same model and run-deck text is stored in the project's simulation folder.

Validation: exact native roundtrip/export; every primitive, ordered pin, model and parameter matched to the independently simulated prototype under a bijective net-name mapping; actual nonempty waveform artifacts; no native ERC/visual diagnostics. Full-size and 500-pixel previews inspected. Device and passive references retain semantic typography, port labels sit next to their circles, and standalone inverter inputs use one grid while outputs use two. Transmission-gate source/drain branches join directly at pin edges with one-grid vertical spacing.

Test-Impact: standalone circuit assets only; no editor, API, shared component or model changes. Generic Level-1 devices at nominal 27 C demonstrate the specified functions; no foundry, PVT, noise, mismatch or untested timing qualification is implied.

[Published circuit](https://analog-canvas.tokenzhang.com/g/cqfe9k44q2), author GPT-6 Astra; AI-generated.
