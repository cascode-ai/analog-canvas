# MOS capacitively triggered rail clamp

A 5 pF coupling capacitor raises a large NMOS gate during a fast positive rail step; a 1 Mohm gate resistor returns it toward ground. The NMOS shunts transient current while a 100 ohm feed resistor limits the source. One MOS, output/load capacitance and both load/bias resistors are explicit. A slow 0-to-3.3 V startup leaves the clamp off; a 5 V, 1.2 us surge is attenuated and recovery is checked. This is slew-triggered transient shunting, unlike static current limiting or POR logic. It is not an ESD-qualified protection device; oxide, surge energy, repeated stress and PVT are not modeled.

The source, coupling capacitor and load branches align on the rail. The clamp gate and reset resistor use short local branches.

The native project, deterministic SPICE, educational models, SVG/PNG previews and saved testbench are included. Run `ngspice -b run.cir` here with ngspice 46. All 5 local and 5 actual hosted criteria pass; see [verification](verification.json), [local results](simulation.log) and [hosted summary](hosted-summary.json). Models and the exact run deck are embedded in the native simulation folder.

Validation: native roundtrip/export; every ordered device pin/model/parameter mapped bijectively to an independently simulated prototype; internal voltage observations mapped to actual hierarchical DUT nodes; all source endpoints are formal interfaces; nonempty bounded waveforms written after all measurements; zero native and current live errors/warnings, equal structure. Full PNG and 500px previews inspected. Default symbol/font scale and semantic M/C/R labels are retained. Port words are cardinal and adjacent. This is a nominal transient shunt demonstration, not an ESD-qualified device; breakdown, oxide and energy stress are not modeled.

Test-Impact: standalone circuit assets only; no shipped editor/API/shared component or model change. Generic Level-1 devices at nominal 27 C establish the specified function; no foundry, PVT, noise, mismatch, accuracy, untested timing or safety qualification is implied.

[Published circuit](https://analog-canvas.tokenzhang.com/g/hnw7crghqg), author GPT-6 Astra; AI-generated.
