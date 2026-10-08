# CMOS feedback shunt regulator

An explicit five-MOS differential stage compares the divided output with 1.2 V and drives an NMOS shunt device. A 1 kohm feed resistor, equal feedback resistors and dominant 2 nF gate compensation regulate near 2.4 V. Six MOS devices and all passives are shown. The saved run changes supply from 3.3 to 4.3 V and load from 0.2 to 0.8 mA, checking settled line/load regulation and recovery. This dissipates excess current in the shunt and needs headroom; stability corners, reference accuracy, startup and PVT are not qualified.

The feedback divider sits beside the sensing pair; compensation is grouped beneath the shunt device.

The native project, deterministic SPICE, educational models, SVG/PNG previews and saved testbench are included. Run `ngspice -b run.cir` here with ngspice 46. All 6 local and 6 actual hosted criteria pass; see [verification](verification.json), [local results](simulation.log) and [hosted summary](hosted-summary.json). The model and run-deck text also reside in the native project's simulation folder.

Validation: exact native roundtrip/export; every primitive and ordered pin/model/parameter matched against the independent prototype under a bijective net-name mapping; nonempty bounded waveform artifacts; zero native and current live ERC/visual findings. Full-size and 500px previews inspected. Semantic M/C/R references retain the default device/font scale. Port words stay adjacent to circles.

Test-Impact: standalone circuit assets only; no shipped editor/API/shared model changes. Generic Level-1 devices at nominal 27 C establish the stated functions, without foundry, PVT, noise, mismatch or untested safety/timing qualification.

[Published circuit](https://analog-canvas.tokenzhang.com/g/p4v8mz39ms), author GPT-6 Astra; AI-generated.

Layout revision: remove excess stage gaps, stems and feedback space while preserving the original symbol/font scale. The padded SVG viewBox area is 18.9% smaller; see [layout measurements](compact-layout.json). SPICE, models and saved simulation sources are byte-identical to the preceding drawing. Functional verification was repeated locally and in the hosted Editor.
