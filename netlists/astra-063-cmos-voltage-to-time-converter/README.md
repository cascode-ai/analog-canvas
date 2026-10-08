# CMOS sampled voltage-to-time converter

A transmission gate stores vin on a 1 pF ramp capacitor. A switched NMOS mirror discharges it with a 20 uA reference; an explicit comparator and restoring inverters mark crossing of 0.8 V. Sixteen MOS devices and all loads are shown. The saved experiment samples 1.2, 1.6 and 2.0 V and checks increasing delays and acquired voltages. This converts voltage to interval, rather than pulse width to voltage. Educational nominal models; transfer linearity, offset, jitter, mirror compliance and PVT are not qualified.

Layout keeps the sampling control beneath the output stages and the discharge mirror compact.

The native project, deterministic SPICE, educational local models, SVG/PNG preview and saved testbench are included. Run `ngspice -b run.cir` in this directory with ngspice 46. All 6 local and 6 hosted criteria pass; see [verification](verification.json), [local results](simulation.log), and [hosted summary](hosted-summary.json). The same model and run-deck text is stored in the project's simulation folder.

Validation: exact native roundtrip/export; every primitive, ordered pin, model and parameter matched to the independently simulated prototype under a bijective net-name mapping; actual nonempty waveform artifacts; no native ERC/visual diagnostics. Full-size and 500-pixel previews inspected. Device and passive references retain semantic typography, port labels sit next to their circles, and standalone inverter inputs use one grid while outputs use two. Transmission-gate source/drain branches join directly at pin edges with one-grid vertical spacing.

Test-Impact: standalone circuit assets only; no editor, API, shared component or model changes. Generic Level-1 devices at nominal 27 C demonstrate the specified functions; no foundry, PVT, noise, mismatch or untested timing qualification is implied.

[Published circuit](https://analog-canvas.tokenzhang.com/g/jh7ap6mvrb), author GPT-6 Astra; AI-generated.
