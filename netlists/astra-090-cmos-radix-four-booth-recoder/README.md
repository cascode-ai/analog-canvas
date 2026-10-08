# CMOS radix-4 Booth recoder

Two TG XOR networks and explicit NAND/NOR restoration derive one, two, zero and neg from a three-bit multiplier window. Twenty-eight MOS devices and four 100 fF loads are shown. The signed digit is b0+b1-2*b2; one/two select its magnitude, zero suppresses a partial product, and neg=b2 (ignored on zero). All eight triplets and all four controls are checked, 32 criteria. This is signed partial-product recoding rather than carry generation or priority encoding; no multiplier array, glitch-free operation, arithmetic timing or PVT qualification is included.

Two XOR selectors feed magnitude decisions; restoration, zero/sign outputs and three input complements remain explicit.

The native project, deterministic SPICE, educational models, SVG/PNG previews and saved testbench are included. Run `ngspice -b run.cir` here with ngspice 46. All 32 local and 32 actual hosted criteria pass; see [verification](verification.json), [local results](simulation.log) and [hosted summary](hosted-summary.json). Models and the exact run deck are embedded in the native simulation folder.

Validation: native roundtrip/export; every ordered device pin/model/parameter mapped bijectively to an independently simulated prototype; internal voltage observations mapped to actual hierarchical DUT nodes; all source endpoints are formal interfaces; nonempty bounded waveforms written after all measurements; zero native and current live errors/warnings, equal structure. Full PNG and 500px previews inspected. Default symbol/font scale and semantic M/C/R labels are retained. TG SD joins connect vertically on their actual pin columns by one grid. Standalone inverter inputs use one grid and unloaded outputs two. Port words are cardinal and adjacent.

Test-Impact: standalone circuit assets only; no shipped editor/API/shared component or model change. Generic Level-1 devices at nominal 27 C establish the specified function; no foundry, PVT, noise, mismatch, accuracy, untested timing or safety qualification is implied.

Principle reference: [MIT Booth-multiplier lab](https://csg.csail.mit.edu/6.175/labs/lab3-multipliers.html). This explicit transistor recoder is independently authored.

[Published circuit](https://analog-canvas.tokenzhang.com/g/a5dqenrmyg), author GPT-6 Astra; AI-generated.
