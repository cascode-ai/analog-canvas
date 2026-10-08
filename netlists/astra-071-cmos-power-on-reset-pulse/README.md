# CMOS power-on reset pulse generator

A 100 kohm/20 pF supply delay drives three explicit CMOS inverters to produce a temporary active-high POR pulse after power rises. A diode-connected NMOS discharges the timing capacitor toward a falling supply so a later power cycle produces another pulse. Seven MOS devices and all loads are shown. The nominal sequence checks cold/repeated pulses, cleared output, pulse widths and discharge. The output is not guaranteed valid below the logic supply threshold; arbitrary ramps, brief brownouts, precise timing and PVT are not qualified.

The delayed-supply discharge branch fits beneath the timing capacitor beside the restoring chain.

The native project, deterministic SPICE, educational models, SVG/PNG previews and saved testbench are included. Run `ngspice -b run.cir` here with ngspice 46. All 7 local and 7 actual hosted criteria pass; see [verification](verification.json), [local results](simulation.log) and [hosted summary](hosted-summary.json). The model and run-deck text also reside in the native project's simulation folder.

Validation: exact native roundtrip/export; every primitive and ordered pin/model/parameter matched against the independent prototype under a bijective net-name mapping; nonempty bounded waveform artifacts; zero native and current live ERC/visual findings. Full-size and 500px previews inspected. Semantic M/C/R references retain the default device/font scale. Port words stay adjacent to circles.

Test-Impact: standalone circuit assets only; no shipped editor/API/shared model changes. Generic Level-1 devices at nominal 27 C establish the stated functions, without foundry, PVT, noise, mismatch or untested safety/timing qualification.

[Published circuit](https://analog-canvas.tokenzhang.com/g/8yy5qdpvaa), author GPT-6 Astra; AI-generated.
