# CMOS dynamic Manchester carry chain

A shared evaluation footer and five precharged nodes evaluate four carry recurrences from explicit propagate/generate inputs and cin. Propagate NMOS devices pass a prior discharge; generate devices create a local discharge. Four inverters restore positive carries. Twenty-three MOS devices and all node/output loads are shown. Ten carry patterns plus precharge are checked. This is a dynamic arithmetic carry network rather than a full-adder or AO21 gate; inputs must settle before evaluation. Keeper strength, leakage retention, input monotonicity hazards and PVT are not qualified.

The dynamic chain runs along one track; generate devices, storage loads and restored outputs form aligned columns.

The native project, deterministic SPICE, educational models, SVG/PNG previews and saved testbench are included. Run `ngspice -b run.cir` here with ngspice 46. All 44 local and 44 actual hosted criteria pass; see [verification](verification.json), [local results](simulation.log) and [hosted summary](hosted-summary.json). The same model and run-deck text is embedded in the native simulation folder.

Validation: exact native roundtrip/export; every primitive and ordered pin/model/parameter matched to an independently simulated prototype under a bijective net-name mapping; nonempty bounded waveforms; zero native/current live ERC and visual findings. Full PNG and 500px previews inspected. M/C/R typography and the default device/font scale are retained; port words remain next to their circles. Standalone control or named-input inverters use one-grid inputs and two-grid output leads when unloaded.

Test-Impact: standalone circuit assets only; no shipped editor/API/shared component or model change. Generic Level-1 devices at nominal 27 C establish the specified functions; no foundry, PVT, noise, mismatch or untested timing/safety qualification is implied.

Layout revision: remove excess stage gaps, stems and feedback space while preserving the original symbol/font scale. The padded SVG viewBox area is 11.3% smaller; see [layout measurements](compact-layout.json). SPICE, models and saved simulation sources are byte-identical to the preceding drawing. Functional verification was repeated locally and in the hosted Editor.

[Published circuit](https://analog-canvas.tokenzhang.com/g/s9xyw2hhah), author GPT-6 Astra; AI-generated.
