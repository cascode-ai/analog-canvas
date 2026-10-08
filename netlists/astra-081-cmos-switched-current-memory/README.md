# CMOS switched-current sample-and-hold

A transmission gate diode-connects an NMOS reference while sample is high. Its 100 pF gate capacitor retains the programmed mirror bias during hold, driving a separate current output. An explicit complement inverter and reset NMOS bring the total to seven MOS. Tests acquire 5, 15 and 30 uA, hold after the input current turns off, change output compliance during hold and reset the stored bias. This stores analog current rather than an input voltage or digital bit. The source must supply current only during acquire; feedthrough, long retention, matching and PVT are not qualified.

The reference MOS faces the output MOS. The sampling gate, storage/load branches and reset branch share one gate-bias bus; the sample complement inverter has a one-grid input and two-grid output.

The native project, deterministic SPICE, educational models, SVG/PNG previews and saved testbench are included. Run `ngspice -b run.cir` here with ngspice 46. All 8 local and 8 actual hosted criteria pass; see [verification](verification.json), [local results](simulation.log) and [hosted summary](hosted-summary.json). Models and the exact run deck are embedded in the native simulation folder.

Validation: native roundtrip/export; every ordered device pin/model/parameter mapped bijectively to an independently simulated prototype; internal voltage observations mapped to actual hierarchical DUT nodes; all source endpoints are formal interfaces; nonempty bounded waveforms written after all measurements; zero native and current live errors/warnings, equal structure. Full PNG and 500px previews inspected. Default symbol/font scale and semantic M/C/R labels are retained. TG SD joins connect vertically on their actual pin columns by one grid. Standalone inverter inputs use one grid and unloaded outputs two. Port words are cardinal and adjacent.

Test-Impact: standalone circuit assets only; no shipped editor/API/shared component or model change. Generic Level-1 devices at nominal 27 C establish the specified function; no foundry, PVT, noise, mismatch, accuracy, untested timing or safety qualification is implied.

[Published circuit](https://analog-canvas.tokenzhang.com/g/27p3h2v6h9), author GPT-6 Astra; AI-generated.
