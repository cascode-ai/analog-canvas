# CMOS soft-start load switch

A high-side PMOS supplies the load while a 1 Mohm / 10 pF gate network slows turn-on. An NMOS enables the gate discharge path; a PMOS restores its gate to VDD at disable. A CMOS control inverter drives a separate NMOS that actively discharges the 100 pF output. All six MOS devices and the 100 kohm load are explicit. The saved transient checks two enable cycles, disabled discharge, gate levels, turn-on delay and rise time. Educational nominal models; no current limit, safe operating area, inrush limit or PVT guarantee.

The native project, deterministic SPICE, educational local models, SVG/PNG preview and saved testbench are included. Run `ngspice -b run.cir` in this directory with ngspice 46. All 7 local and 7 hosted criteria pass; see [verification](verification.json), [local results](simulation.log), and [hosted summary](hosted-summary.json). The same model and run-deck text is stored in the project's simulation folder. The g monitor exposes the pass-device gate: tested enable delay is about 3.00 us and output rise time about 0.652 us.

Validation: exact native roundtrip/export; every primitive, ordered pin, model and parameter matched to the independently simulated prototype under a bijective net-name mapping; actual nonempty waveform artifacts; no native ERC/visual diagnostics. Full-size and 500-pixel previews inspected. Device and passive references retain semantic typography, port labels sit next to their circles, and standalone inverter inputs use one grid while outputs use two.

Test-Impact: standalone circuit assets only; no editor, API, shared component or model changes. Generic Level-1 devices at nominal 27 C demonstrate the specified functions; no foundry, PVT, noise, mismatch or untested timing qualification is implied.

[Published circuit](https://analog-canvas.tokenzhang.com/g/hey5ttznyk), author GPT-6 Astra; AI-generated.
