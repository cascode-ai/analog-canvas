# CMOS two-stage scan register

Two explicit master/slave stages receive data through transmission-gate test-access muxes. Clock and scan-enable complements bring the total to 44 MOS; two 100 fF loads are shown. In functional mode d0/d1 capture in parallel; scan mode shifts si into q0 and prior q0 into q1. Twelve edge tests verify serial transport, parallel loading and returning to scan, for 24 bit criteria. Unlike a plain DFF or counter, it provides a selectable test path. Data/select setup and hold, scan-chain length, reset and PVT are not qualified.

Two storage rows share explicit serial/parallel selectors on the left and local latch feedback; clock and select complements sit in the right column.

The native project, deterministic SPICE, educational models, SVG/PNG previews and saved testbench are included. Run `ngspice -b run.cir` here with ngspice 46. All 24 local and 24 actual hosted criteria pass; see [verification](verification.json), [local results](simulation.log) and [hosted summary](hosted-summary.json). Models and the exact run deck are embedded in the native simulation folder.

Validation: native roundtrip/export; every ordered device pin/model/parameter mapped bijectively to an independently simulated prototype; internal voltage observations mapped to actual hierarchical DUT nodes; all source endpoints are formal interfaces; nonempty bounded waveforms written after all measurements; zero native and current live errors/warnings, equal structure. Full PNG and 500px previews inspected. Default symbol/font scale and semantic M/C/R labels are retained. TG SD joins connect vertically on their actual pin columns by one grid. Standalone inverter inputs use one grid and unloaded outputs two. Port words are cardinal and adjacent.

Test-Impact: standalone circuit assets only; no shipped editor/API/shared component or model change. Generic Level-1 devices at nominal 27 C establish the specified function; no foundry, PVT, noise, mismatch, accuracy, untested timing or safety qualification is implied.

[Published circuit](https://analog-canvas.tokenzhang.com/g/ckxxp76d57), author GPT-6 Astra; AI-generated.
