# CMOS square-law RF power detector

Two separately biased NMOS devices sum currents from opposite-phase RF inputs. A PMOS mirror copies their sum into a 1 kohm/10 nF output load. Four MOS devices and both passives are explicit. At 1 MHz, excess output above the disclosed DC baseline scales approximately with the square of 0.1, 0.2 and 0.3 V input amplitudes; carrier ripple is also checked. Unlike the mixers, it measures RF power without a separate LO. The behavioral voltage sources only supply external test signals. Offset cancellation, calibrated power accuracy, RF bandwidth, noise and PVT are not qualified.

The differential square-law inputs and PMOS mirror occupy the left group; the output resistor and filtering capacitor occupy the right group.

The native project, deterministic SPICE, educational models, SVG/PNG previews and saved testbench are included. Run `ngspice -b run.cir` here with ngspice 46. All 5 local and 5 actual hosted criteria pass; see [verification](verification.json), [local results](simulation.log) and [hosted summary](hosted-summary.json). Models and the exact run deck are embedded in the native simulation folder.

Validation: native roundtrip/export; every ordered device pin/model/parameter mapped bijectively to an independently simulated prototype; internal voltage observations mapped to actual hierarchical DUT nodes; all source endpoints are formal interfaces; nonempty bounded waveforms written after all measurements; zero native and current live errors/warnings, equal structure. Full PNG and 500px previews inspected. Default symbol/font scale and semantic M/C/R labels are retained. Port words are cardinal and adjacent. Behavioral voltage sources generate only external RF test stimuli, not any DUT function.

Test-Impact: standalone circuit assets only; no shipped editor/API/shared component or model change. Generic Level-1 devices at nominal 27 C establish the specified function; no foundry, PVT, noise, mismatch, accuracy, untested timing or safety qualification is implied.

[Published circuit](https://analog-canvas.tokenzhang.com/g/gqyxz9e4c5), author GPT-6 Astra; AI-generated.
