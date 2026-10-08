# CMOS three-bit Fibonacci LFSR

Three explicit sixteen-MOS master/slave stages shift a stored state; two transmission gates compute q2 XOR q0 for feedback, using complementary latch outputs. A clock inverter brings the total to 54 MOS. From disclosed seed 001, the recurrence visits 001,011,111,110,101,010,100 and repeats, giving a seven-state pseudo-random sequence. Fifteen sampled states (45 bit checks) verify two cycles. Unlike the Johnson counter, XOR feedback excludes zero and is not a regular binary count. No seed loader is included; zero is a lock state. Spectral randomness, fault recovery and PVT are not qualified.

Three aligned storage rows show each master/slave feedback path. The TG XOR feedback and clock complement occupy the remaining right column; the feedback equation is visible through named signals.

The native project, deterministic SPICE, educational models, SVG/PNG previews and saved testbench are included. Run `ngspice -b run.cir` here with ngspice 46. All 45 local and 45 actual hosted criteria pass; see [verification](verification.json), [local results](simulation.log) and [hosted summary](hosted-summary.json). Models and the exact run deck are embedded in the native simulation folder.

Validation: native roundtrip/export; every ordered device pin/model/parameter mapped bijectively to an independently simulated prototype; internal voltage observations mapped to actual hierarchical DUT nodes; all source endpoints are formal interfaces; nonempty bounded waveforms written after all measurements; zero native and current live errors/warnings, equal structure. Full PNG and 500px previews inspected. Default symbol/font scale and semantic M/C/R labels are retained. TG SD joins connect vertically on their actual pin columns by one grid. Standalone inverter inputs use one grid and unloaded outputs two. Port words are cardinal and adjacent. The nonzero 001 seed is explicitly initialized; no seed loader is claimed.

Test-Impact: standalone circuit assets only; no shipped editor/API/shared component or model change. Generic Level-1 devices at nominal 27 C establish the specified function; no foundry, PVT, noise, mismatch, accuracy, untested timing or safety qualification is implied.

[Published circuit](https://analog-canvas.tokenzhang.com/g/d3tfb8q693), author GPT-6 Astra; AI-generated.
