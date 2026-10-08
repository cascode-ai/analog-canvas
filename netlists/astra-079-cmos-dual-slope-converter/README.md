# CMOS dual-slope voltage-to-time converter

An explicit five-MOS closed-loop integrator integrates input current through 100 kohm onto a 10 pF feedback capacitor for a fixed interval, then a switched reference reverses the ramp. A second transistor sensing stage and two restoring inverters mark return crossing. Twenty-six MOS devices, all phase complements, three TG switches and loads are shown. Three inputs above common mode check increasing reference-return intervals, integrated ramp and virtual-node bias. This performs two-slope integration rather than acquiring the input directly on a ramp capacitor. Offset, reference accuracy, conversion linearity, phase jitter and PVT are not qualified.

Input and reset gates share a left column; phase controls fit below the integrator and sensing stages.

The native project, deterministic SPICE, educational models, SVG/PNG previews and saved testbench are included. Run `ngspice -b run.cir` here with ngspice 46. All 15 local and 15 actual hosted criteria pass; see [verification](verification.json), [local results](simulation.log) and [hosted summary](hosted-summary.json). The same model and run-deck text is embedded in the native simulation folder.

Validation: exact native roundtrip/export; every primitive and ordered pin/model/parameter matched to an independently simulated prototype under a bijective net-name mapping; nonempty bounded waveforms; zero native/current live ERC and visual findings. Full PNG and 500px previews inspected. M/C/R typography and the default device/font scale are retained; port words remain next to their circles. Transmission-gate SD joins are directly at real pin edges with one-grid vertical connections. Standalone control or named-input inverters use one-grid inputs and two-grid output leads when unloaded.

Test-Impact: standalone circuit assets only; no shipped editor/API/shared component or model change. Generic Level-1 devices at nominal 27 C establish the specified functions; no foundry, PVT, noise, mismatch or untested timing/safety qualification is implied.

Layout revision: remove excess stage gaps, stems and feedback space while preserving the original symbol/font scale. The padded SVG viewBox area is 18.1% smaller; see [layout measurements](compact-layout.json). SPICE, models and saved simulation sources are byte-identical to the preceding drawing. Functional verification was repeated locally and in the hosted Editor.

[Published circuit](https://analog-canvas.tokenzhang.com/g/kpn7fbhwxm), author GPT-6 Astra; AI-generated.
