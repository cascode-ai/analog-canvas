# CMOS hysteretic under-voltage lockout

A five-MOS comparator senses a divided supply against an external 1.0 V reference. Two output inverters and one NMOS feed a positive-feedback resistor path, giving distinct rising/falling supply thresholds near 3.0/2.5 V. Ten MOS and all divider/feedback/compensation loads are explicit. Two slow supply rises and a fall verify both trip points and enabled/disabled levels. Unlike a power-on-reset pulse or window detector, enable is a retained hysteretic level. The 0.9 V tail bias and reference must already be available; fast brownouts, startup availability, hysteresis accuracy and PVT are not qualified.

The divider, comparator and output buffers align along the decision path. The positive-feedback resistor/NMOS branch carries explicit EN and SENSE names.

The native project, deterministic SPICE, educational models, SVG/PNG previews and saved testbench are included. Run `ngspice -b run.cir` here with ngspice 46. All 7 local and 7 actual hosted criteria pass; see [verification](verification.json), [local results](simulation.log) and [hosted summary](hosted-summary.json). Models and the exact run deck are embedded in the native simulation folder.

Validation: native roundtrip/export; every ordered device pin/model/parameter mapped bijectively to an independently simulated prototype; internal voltage observations mapped to actual hierarchical DUT nodes; all source endpoints are formal interfaces; nonempty bounded waveforms written after all measurements; zero native and current live errors/warnings, equal structure. Full PNG and 500px previews inspected. Default symbol/font scale and semantic M/C/R labels are retained. Port words are cardinal and adjacent. The external reference and bias must already be available; this circuit does not generate them.

Test-Impact: standalone circuit assets only; no shipped editor/API/shared component or model change. Generic Level-1 devices at nominal 27 C establish the specified function; no foundry, PVT, noise, mismatch, accuracy, untested timing or safety qualification is implied.

[Published circuit](https://analog-canvas.tokenzhang.com/g/w5x89fwps2), author GPT-6 Astra; AI-generated.
