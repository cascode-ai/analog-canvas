# MOS high-side current limiter

A PMOS pass transistor and upstream 100 ohm sense resistor deliver the load current. A second PMOS senses the resistor drop and raises the pass gate against a 100 kohm pull-down to limit current. Both MOS devices and the output capacitor are explicit. An external conductance load changes from 1 kohm to 100 and 10 ohms; tests check normal output and approximately constant overload/near-short current. The behavioral load exists only in the testbench, not the DUT. Nominal educational models; limit accuracy, fault power, transient overshoot, thermal safety and PVT are not qualified.

The sensing device and gate pull-down sit directly beneath the pass device, with the sense monitor on a short branch.

The native project, deterministic SPICE, educational models, SVG/PNG previews and saved testbench are included. Run `ngspice -b run.cir` here with ngspice 46. All 5 local and 5 actual hosted criteria pass; see [verification](verification.json), [local results](simulation.log) and [hosted summary](hosted-summary.json). The model and run-deck text also reside in the native project's simulation folder.

Validation: exact native roundtrip/export; every primitive and ordered pin/model/parameter matched against the independent prototype under a bijective net-name mapping; nonempty bounded waveform artifacts; zero native and current live ERC/visual findings. Full-size and 500px previews inspected. Semantic M/C/R references retain the default device/font scale. Port words stay adjacent to circles.

Test-Impact: standalone circuit assets only; no shipped editor/API/shared model changes. Generic Level-1 devices at nominal 27 C establish the stated functions, without foundry, PVT, noise, mismatch or untested safety/timing qualification.

[Published circuit](https://analog-canvas.tokenzhang.com/g/sqhwscyb6f), author GPT-6 Astra; AI-generated.
