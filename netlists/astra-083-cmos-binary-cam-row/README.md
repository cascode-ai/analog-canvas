# CMOS two-bit binary CAM row

Two writable six-MOS SRAM cells drive four-NMOS mismatch trees on a shared precharged match line. A clock footer, miss inverter and two search-complement inverters bring the total to 28 MOS. A matching stored/search word leaves ml high and miss low; any mismatch discharges ml. All four stored words and all four searches are checked, plus storage bits. This compares a retained word rather than two continuously driven inputs; write bitlines are differential and search runs only after write. Search delay, retention yield, disturb margins and PVT are not qualified.

Two opposed-inverter storage cores show rectangular cross-coupled feedback, access transistors and bitlines. Adjacent mismatch trees feed the shared match-line name; precharge, footer and search-complement inverters remain separate explicit devices.

The native project, deterministic SPICE, educational models, SVG/PNG previews and saved testbench are included. Run `ngspice -b run.cir` here with ngspice 46. All 24 local and 24 actual hosted criteria pass; see [verification](verification.json), [local results](simulation.log) and [hosted summary](hosted-summary.json). Models and the exact run deck are embedded in the native simulation folder.

Validation: native roundtrip/export; every ordered device pin/model/parameter mapped bijectively to an independently simulated prototype; internal voltage observations mapped to actual hierarchical DUT nodes; all source endpoints are formal interfaces; nonempty bounded waveforms written after all measurements; zero native and current live errors/warnings, equal structure. Full PNG and 500px previews inspected. Default symbol/font scale and semantic M/C/R labels are retained. Standalone inverter inputs use one grid and unloaded outputs two. Port words are cardinal and adjacent.

Test-Impact: standalone circuit assets only; no shipped editor/API/shared component or model change. Generic Level-1 devices at nominal 27 C establish the specified function; no foundry, PVT, noise, mismatch, accuracy, untested timing or safety qualification is implied.

Architecture reference: [Texas A&M memory lecture](https://people.engr.tamu.edu/sunilkhatri/courses/ee449/notes/memories.pdf). The two-bit circuit and testbench here are independently authored.

[Published circuit](https://analog-canvas.tokenzhang.com/g/qc66tw3ksf), author GPT-6 Astra; AI-generated.
