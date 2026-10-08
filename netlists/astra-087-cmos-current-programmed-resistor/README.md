# CMOS current-programmed floating resistor

Complementary signal MOS devices operate in triode between vin and out. Two diode-connected replicas referenced to out generate gate overdrives from matched external bias currents. Four MOS devices are explicit. At 1.65 V common mode, both signs of a 50 mV differential signal check resistance near 3.7, 1.9 and 0.94 kohm for 5, 20 and 80 uA bias. This is continuous impedance tuning rather than binary channel selection. Large-signal linearity, full common-mode range, noise and PVT are not qualified.

Diode replicas share one row with the complementary signal channel; named GN/GP/OUT links keep control leads short. Separate VDD and ground markers represent the body supplies.

The native project, deterministic SPICE, educational models, SVG/PNG previews and saved testbench are included. Run `ngspice -b run.cir` here with ngspice 46. All 6 local and 6 actual hosted criteria pass; see [verification](verification.json), [local results](simulation.log) and [hosted summary](hosted-summary.json). Models and the exact run deck are embedded in the native simulation folder.

Validation: native roundtrip/export; every ordered device pin/model/parameter mapped bijectively to an independently simulated prototype; internal voltage observations mapped to actual hierarchical DUT nodes; all source endpoints are formal interfaces; nonempty bounded waveforms written after all measurements; zero native and current live errors/warnings, equal structure. Full PNG and 500px previews inspected. Default symbol/font scale and semantic M/C/R labels are retained. TG SD joins connect vertically on their actual pin columns by one grid. Port words are cardinal and adjacent. NMOS bodies connect to ground and PMOS bodies to VDD, while source nodes can sit at OUT. The default three-terminal artwork hides bulk, but native and SPICE bindings are explicit.

Test-Impact: standalone circuit assets only; no shipped editor/API/shared component or model change. Generic Level-1 devices at nominal 27 C establish the specified function; no foundry, PVT, noise, mismatch, accuracy, untested timing or safety qualification is implied.

[Published circuit](https://analog-canvas.tokenzhang.com/g/rw3maw2ebg), author GPT-6 Astra; AI-generated.
