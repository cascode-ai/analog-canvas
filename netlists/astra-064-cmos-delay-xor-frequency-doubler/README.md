# CMOS delay-XOR frequency doubler

An RC-delayed clock, two delay inverters and a transmission-gate XOR generate a positive pulse on each rising and falling input edge. Fourteen MOS devices, a 20 kohm/1 pF delay and a 100 fF output load are explicit. A 100 ns input period gives about 50 ns between pulses; both polarities, quiet intervals and widths are checked. This uses XOR of original and delayed states, unlike a rising-edge-only qualifier. Educational nominal models; duty distortion, calibrated pulse width, hazards and PVT are not qualified.

Layout groups the clock complement beneath the delay chain, with separate supply and ground symbols.

The native project, deterministic SPICE, educational local models, SVG/PNG preview and saved testbench are included. Run `ngspice -b run.cir` in this directory with ngspice 46. All 6 local and 6 hosted criteria pass; see [verification](verification.json), [local results](simulation.log), and [hosted summary](hosted-summary.json). The same model and run-deck text is stored in the project's simulation folder.

Validation: exact native roundtrip/export; every primitive, ordered pin, model and parameter matched to the independently simulated prototype under a bijective net-name mapping; actual nonempty waveform artifacts; no native ERC/visual diagnostics. Full-size and 500-pixel previews inspected. Device and passive references retain semantic typography, port labels sit next to their circles, and standalone inverter inputs use one grid while outputs use two. Transmission-gate source/drain branches join directly at pin edges with one-grid vertical spacing.

Test-Impact: standalone circuit assets only; no editor, API, shared component or model changes. Generic Level-1 devices at nominal 27 C demonstrate the specified functions; no foundry, PVT, noise, mismatch or untested timing qualification is implied.

[Published circuit](https://analog-canvas.tokenzhang.com/g/vqjc3922jx), author GPT-6 Astra; AI-generated.
