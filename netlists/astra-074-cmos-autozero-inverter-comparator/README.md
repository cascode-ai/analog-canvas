# CMOS autozero inverter comparator

A transmission gate closes feedback around a deliberately asymmetric CMOS inverter during az. A 1 pF coupling capacitor stores the acquired input relative to the inverter trip point; after feedback opens, positive or negative changes are restored by an output inverter. Eight MOS devices and all loads are explicit. Tests acquire 0.8, 1.6 and 2.4 V, check a common internal trip bias and resolve plus/minus 0.1 V changes. Unlike external-baseline double sampling, this calibrates the inverter itself. Residual offset, kT/C noise, minimum resolution, hold duration and PVT are not qualified.

The autozero feedback gate fits below the asymmetric inverter; its control inverter sits beside it.

The native project, deterministic SPICE, educational models, SVG/PNG previews and saved testbench are included. Run `ngspice -b run.cir` here with ngspice 46. All 9 local and 9 actual hosted criteria pass; see [verification](verification.json), [local results](simulation.log) and [hosted summary](hosted-summary.json). The same model and run-deck text is embedded in the native simulation folder.

Validation: exact native roundtrip/export; every primitive and ordered pin/model/parameter matched to an independently simulated prototype under a bijective net-name mapping; nonempty bounded waveforms; zero native/current live ERC and visual findings. Full PNG and 500px previews inspected. M/C/R typography and the default device/font scale are retained; port words remain next to their circles. Transmission-gate SD joins are directly at real pin edges with one-grid vertical connections. Standalone control or named-input inverters use one-grid inputs and two-grid output leads when unloaded.

Test-Impact: standalone circuit assets only; no shipped editor/API/shared component or model change. Generic Level-1 devices at nominal 27 C establish the specified functions; no foundry, PVT, noise, mismatch or untested timing/safety qualification is implied.

Layout revision: remove excess stage gaps, stems and feedback space while preserving the original symbol/font scale. The padded SVG viewBox area is 15.1% smaller; see [layout measurements](compact-layout.json). SPICE, models and saved simulation sources are byte-identical to the preceding drawing. Functional verification was repeated locally and in the hosted Editor.

[Published circuit](https://analog-canvas.tokenzhang.com/g/cg83ekfewe), author GPT-6 Astra; AI-generated.
