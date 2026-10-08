# CMOS current-controlled ring oscillator

Three four-MOS current-starved delay cells form an odd ring. Explicit NMOS/PMOS bias mirrors copy the input reference current into each header/footer; two inverters restore the output. Nineteen MOS devices and four 100 fF loads are shown. An initialized nominal run changes reference current from 20 to 40 to 80 uA, checking periods, near-doubling frequency ratios and logic swing. This continuously converts current to frequency, unlike the enable-controlled ordinary inverter ring. Startup yield, linearity across a wider range, jitter, phase noise and PVT are not qualified.

Three current-starved cells align along one signal path, with a compact bias mirror and a single lower feedback return.

The native project, deterministic SPICE, educational models, SVG/PNG previews and saved testbench are included. Run `ngspice -b run.cir` here with ngspice 46. All 9 local and 9 actual hosted criteria pass; see [verification](verification.json), [local results](simulation.log) and [hosted summary](hosted-summary.json). The model and run-deck text also reside in the native project's simulation folder.

Validation: exact native roundtrip/export; every primitive and ordered pin/model/parameter matched against the independent prototype under a bijective net-name mapping; nonempty bounded waveform artifacts; zero native and current live ERC/visual findings. Full-size and 500px previews inspected. Semantic M/C/R references retain the default device/font scale. Port words stay adjacent to circles.

Test-Impact: standalone circuit assets only; no shipped editor/API/shared model changes. Generic Level-1 devices at nominal 27 C establish the stated functions, without foundry, PVT, noise, mismatch or untested safety/timing qualification.

[Published circuit](https://analog-canvas.tokenzhang.com/g/s5wdzz3652), author GPT-6 Astra; AI-generated.

Layout revision: remove excess stage gaps, stems and feedback space while preserving the original symbol/font scale. The padded SVG viewBox area is 9.4% smaller; see [layout measurements](compact-layout.json). SPICE, models and saved simulation sources are byte-identical to the preceding drawing. Functional verification was repeated locally and in the hosted Editor.
