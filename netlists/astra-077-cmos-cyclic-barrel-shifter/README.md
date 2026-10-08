# CMOS 4-bit cyclic barrel shifter

Two levels of four transmission-gate selectors rotate a four-bit word left by zero, one, two or three positions. Two CMOS inverters create selector complements. Thirty-six explicit MOS devices drive four 100 fF output loads, with no logic black boxes. All 16 words at all four shift settings are checked, giving 256 bit criteria. The network preserves and permutes all four data lanes, unlike a single analog-input mux. Switching glitches, fanout limits, delay and PVT are not qualified.

Four data lanes share the same two selector columns; control inverters occupy the space between stages.

The native project, deterministic SPICE, educational models, SVG/PNG previews and saved testbench are included. Run `ngspice -b run.cir` here with ngspice 46. All 256 local and 256 actual hosted criteria pass; see [verification](verification.json), [local results](simulation.log) and [hosted summary](hosted-summary.json). The same model and run-deck text is embedded in the native simulation folder.

Validation: exact native roundtrip/export; every primitive and ordered pin/model/parameter matched to an independently simulated prototype under a bijective net-name mapping; nonempty bounded waveforms; zero native/current live ERC and visual findings. Full PNG and 500px previews inspected. M/C/R typography and the default device/font scale are retained; port words remain next to their circles. Transmission-gate SD joins are directly at real pin edges with one-grid vertical connections. Standalone control or named-input inverters use one-grid inputs and two-grid output leads when unloaded.

Test-Impact: standalone circuit assets only; no shipped editor/API/shared component or model change. Generic Level-1 devices at nominal 27 C establish the specified functions; no foundry, PVT, noise, mismatch or untested timing/safety qualification is implied.

Layout revision: remove excess stage gaps, stems and feedback space while preserving the original symbol/font scale. The padded SVG viewBox area is 18.5% smaller; see [layout measurements](compact-layout.json). SPICE, models and saved simulation sources are byte-identical to the preceding drawing. Functional verification was repeated locally and in the hosted Editor.

[Published circuit](https://analog-canvas.tokenzhang.com/g/5gfy6j7jwg), author GPT-6 Astra; AI-generated.
