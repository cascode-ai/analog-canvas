# CMOS active-RC all-pass phase shifter

An explicit five-MOS differential stage with equal input/feedback resistors realizes approximately 2*LP-VIN, where a 100 kohm/100 pF branch makes LP. The ideal first-order transfer changes phase from zero toward -180 degrees while retaining unit magnitude; nominal gain/phase are checked at 1, 15.915 and 100 kHz, plus DC bias. This equalizes phase rather than attenuating a low/high band. Finite amplifier gain affects the ideal response. Bandwidth outside those points, linear swing, noise and PVT are not qualified.

The RC input branch directly drives one differential input. Named FB connections identify the two equal summing resistors; the output feedback/load branches fit beside the sensing stage.

The native project, deterministic SPICE, educational models, SVG/PNG previews and saved testbench are included. Run `ngspice -b run.cir` here with ngspice 46. All 7 local and 7 actual hosted criteria pass; see [verification](verification.json), [local results](simulation.log) and [hosted summary](hosted-summary.json). Models and the exact run deck are embedded in the native simulation folder.

Validation: native roundtrip/export; every ordered device pin/model/parameter mapped bijectively to an independently simulated prototype; internal voltage observations mapped to actual hierarchical DUT nodes; all source endpoints are formal interfaces; nonempty bounded waveforms written after all measurements; zero native and current live errors/warnings, equal structure. Full PNG and 500px previews inspected. Default symbol/font scale and semantic M/C/R labels are retained. Port words are cardinal and adjacent.

Test-Impact: standalone circuit assets only; no shipped editor/API/shared component or model change. Generic Level-1 devices at nominal 27 C establish the specified function; no foundry, PVT, noise, mismatch, accuracy, untested timing or safety qualification is implied.

[Published circuit](https://analog-canvas.tokenzhang.com/g/k4x6q4qhth), author GPT-6 Astra; AI-generated.
