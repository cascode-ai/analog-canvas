# CMOS first-order sigma-delta modulator

A five-MOS capacitive integrator and five-MOS comparator feed a clocked sixteen-MOS master/slave quantizer. Four DAC MOS devices select 1.0 or 2.3 V from the stored bit; explicit clock/reset complements and a reset TG bring the total to 36 MOS. The 1 MHz bit density tracks three DC inputs around 1.65 V, unlike the fixed-interval dual-slope converter. Tests check density and bounded integrator state. This is a modulator only; no decimation filter, ENOB, noise shaping spectrum, clock-jitter or PVT qualification.

The integrator and comparator occupy the upper row; the clocked quantizer and DAC feedback occupy the lower row. Short named connections make the feedback and reset signals explicit.

The native project, deterministic SPICE, educational models, SVG/PNG previews and saved testbench are included. Run `ngspice -b run.cir` here with ngspice 46. All 6 local and 6 actual hosted criteria pass; see [verification](verification.json), [local results](simulation.log) and [hosted summary](hosted-summary.json). Models and the exact run deck are embedded in the native simulation folder.

Validation: native roundtrip/export; every ordered device pin/model/parameter mapped bijectively to an independently simulated prototype; internal voltage observations mapped to actual hierarchical DUT nodes; all source endpoints are formal interfaces; nonempty bounded waveforms written after all measurements; zero native and current live errors/warnings, equal structure. Full PNG and 500px previews inspected. Default symbol/font scale and semantic M/C/R labels are retained. TG SD joins connect vertically on their actual pin columns by one grid. Standalone inverter inputs use one grid and unloaded outputs two. Port words are cardinal and adjacent.

Test-Impact: standalone circuit assets only; no shipped editor/API/shared component or model change. Generic Level-1 devices at nominal 27 C establish the specified function; no foundry, PVT, noise, mismatch, accuracy, untested timing or safety qualification is implied.

Principle reference: [Analog Devices first-order delta-sigma lab](https://wiki.analog.com/university/courses/alm1k/alm-signals-labs/alm-delta-sigma-lab). The explicit transistor circuit and nominal validation here are independently authored.

[Published circuit](https://analog-canvas.tokenzhang.com/g/pwtqm9kxkb), author GPT-6 Astra; AI-generated.
