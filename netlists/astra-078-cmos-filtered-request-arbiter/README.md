# CMOS filtered two-request arbiter

Cross-coupled NAND stages retain an ordered request winner. Two NMOS devices sense opposite gate/source latch voltages; pull-up loads and output inverters withhold grants while the differential state is unresolved. Fourteen MOS devices and all loads are explicit. Tests cover either request first, holding while both request, transfer after release, idle and settled exclusivity after a simultaneous request. This adds an analog differential filter to request arbitration, unlike a bare SR latch. Simultaneous requests may remain unresolved; bounded resolution time, asynchronous hazard freedom, metastability MTBF and PVT are not qualified.

The NAND request state and differential grant filters form separate adjacent groups with short named connections.

The native project, deterministic SPICE, educational models, SVG/PNG previews and saved testbench are included. Run `ngspice -b run.cir` here with ngspice 46. All 19 local and 19 actual hosted criteria pass; see [verification](verification.json), [local results](simulation.log) and [hosted summary](hosted-summary.json). The same model and run-deck text is embedded in the native simulation folder.

Validation: exact native roundtrip/export; every primitive and ordered pin/model/parameter matched to an independently simulated prototype under a bijective net-name mapping; nonempty bounded waveforms; zero native/current live ERC and visual findings. Full PNG and 500px previews inspected. M/C/R typography and the default device/font scale are retained; port words remain next to their circles.

Test-Impact: standalone circuit assets only; no shipped editor/API/shared component or model change. Generic Level-1 devices at nominal 27 C establish the specified functions; no foundry, PVT, noise, mismatch or untested timing/safety qualification is implied.

Layout revision: remove excess stage gaps, stems and feedback space while preserving the original symbol/font scale. The padded SVG viewBox area is 18.6% smaller; see [layout measurements](compact-layout.json). SPICE, models and saved simulation sources are byte-identical to the preceding drawing. Functional verification was repeated locally and in the hosted Editor.

[Published circuit](https://analog-canvas.tokenzhang.com/g/paqvjdterk), author GPT-6 Astra; AI-generated.
