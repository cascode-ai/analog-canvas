# MOS full-wave current rectifier

An NMOS diode detects positive input current; a PMOS diode detects negative current. The latter mirror drives a second NMOS diode/mirror referenced to -1.8 V, folding both polarities into a positive output sink. Six MOS devices and a weak zero-current bias resistor are explicit. NMOS bodies connect to -1.8 V and PMOS bodies to +1.8 V to avoid clamping either input polarity. The nominal output is biased at 1.2 V; tests rectify both signs of 5, 15 and 30 uA plus zero. This is absolute-current rectification, unlike the one-sided current-subtraction cell. Compliance range, near-zero crossover accuracy and PVT are not qualified.

The positive and negative input detectors share the input column; the negative branch folds through the lower mirror into the same output. The separate VDD marker supplies PMOS bodies. NMOS bodies use VEE; source/body differences are intentional and stored explicitly in the native properties.

The native project, deterministic SPICE, educational models, SVG/PNG previews and saved testbench are included. Run `ngspice -b run.cir` here with ngspice 46. All 7 local and 7 actual hosted criteria pass; see [verification](verification.json), [local results](simulation.log) and [hosted summary](hosted-summary.json). Models and the exact run deck are embedded in the native simulation folder.

Validation: native roundtrip/export; every ordered device pin/model/parameter mapped bijectively to an independently simulated prototype; internal voltage observations mapped to actual hierarchical DUT nodes; all source endpoints are formal interfaces; nonempty bounded waveforms written after all measurements; zero native and current live errors/warnings, equal structure. Full PNG and 500px previews inspected. Default symbol/font scale and semantic M/C/R labels are retained. Port words are cardinal and adjacent. Sources are ground on the input detectors; NMOS bodies are at -1.8 V and PMOS bodies at +1.8 V. The output is biased at 1.2 V. The default three-terminal artwork hides the bulk pin; the native bindings and SPICE explicitly preserve the body supplies.

Test-Impact: standalone circuit assets only; no shipped editor/API/shared component or model change. Generic Level-1 devices at nominal 27 C establish the specified function; no foundry, PVT, noise, mismatch, accuracy, untested timing or safety qualification is implied.

[Published circuit](https://analog-canvas.tokenzhang.com/g/gds5cyv4rz), author GPT-6 Astra; AI-generated.
