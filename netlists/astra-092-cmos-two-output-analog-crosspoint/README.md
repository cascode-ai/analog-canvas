# CMOS two-output analog crosspoint

Four transmission gates and two select-complement inverters route either of two inputs independently to each output. Twelve MOS, two 1 pF loads and two leakage resistors are explicit. All four routing commands are exercised at two input pairs, giving 16 output checks, including both broadcast states and the two permutations. Unlike a single-output mux or fixed differential commutator, each output has an independent address. Break-before-make timing, loading, crosstalk, switching spikes and PVT are not qualified.

Two independently selected output groups align along the data row, with their control inverters below.

The native project, deterministic SPICE, educational models, SVG/PNG previews and saved testbench are included. Run `ngspice -b run.cir` here with ngspice 46. All 16 local and 16 actual hosted criteria pass; see [verification](verification.json), [local results](simulation.log) and [hosted summary](hosted-summary.json). Models and the exact run deck are embedded in the native simulation folder.

Validation: native roundtrip/export; every ordered device pin/model/parameter mapped bijectively to an independently simulated prototype; internal voltage observations mapped to actual hierarchical DUT nodes; all source endpoints are formal interfaces; nonempty bounded waveforms written after all measurements; zero native and current live errors/warnings, equal structure. Full PNG and 500px previews inspected. Default symbol/font scale and semantic M/C/R labels are retained. TG SD joins connect vertically on their actual pin columns by one grid. Standalone inverter inputs use one grid and unloaded outputs two. Port words are cardinal and adjacent.

Test-Impact: standalone circuit assets only; no shipped editor/API/shared component or model change. Generic Level-1 devices at nominal 27 C establish the specified function; no foundry, PVT, noise, mismatch, accuracy, untested timing or safety qualification is implied.

[Published circuit](https://analog-canvas.tokenzhang.com/g/x3sa2zsz7d), author GPT-6 Astra; AI-generated.
