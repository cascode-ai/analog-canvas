# CMOS Schmitt RC relaxation oscillator

A six-MOS Schmitt inverter with two restoring inverters drives a 100 kohm / 100 pF feedback network. Ten MOS devices and all feedback/storage loads are explicit. Charging and discharging the input capacitor between hysteresis thresholds produces autonomous oscillation without a clock input. The saved initialized transient checks period, high duration, output rails and capacitor extrema. Educational nominal models; startup yield, calibrated frequency, jitter, duty-cycle corners and PVT are not qualified.

The native project, deterministic SPICE, educational local models, SVG/PNG preview and saved testbench are included. Run `ngspice -b run.cir` in this directory with ngspice 46. All 6 local and 6 hosted criteria pass; see [verification](verification.json), [local results](simulation.log), and [hosted summary](hosted-summary.json). The same model and run-deck text is stored in the project's simulation folder. Gear integration is used for this stiff regenerative network; the initial capacitor voltage sets simulation startup phase.

Validation: exact native roundtrip/export; every primitive, ordered pin, model and parameter matched to the independently simulated prototype under a bijective net-name mapping; actual nonempty waveform artifacts; no native ERC/visual diagnostics. Full-size and 500-pixel previews inspected. Device and passive references retain semantic typography, port labels sit next to their circles, and standalone inverter inputs use one grid while outputs use two.

Test-Impact: standalone circuit assets only; no editor, API, shared component or model changes. Generic Level-1 devices at nominal 27 C demonstrate the specified functions; no foundry, PVT, noise, mismatch or untested timing qualification is implied.

[Published circuit](https://analog-canvas.tokenzhang.com/g/9a7axkp7w8), author GPT-6 Astra; AI-generated.
