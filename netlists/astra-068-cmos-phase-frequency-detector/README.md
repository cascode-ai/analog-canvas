# CMOS asynchronous-reset phase-frequency detector

Two explicit positive-edge master/slave flip-flops remember which clock arrived first. A six-MOS AOI21 and inverter reset both stages when UP and DN are high or POR is asserted. Reset-dominant master NOR and slave NAND feedback avoid clock-dependent reset contention. Fifty-two MOS devices and three 100 fF loads are shown. Tests cover either phase lead, pulse widths, automatic reset, an extra edge while waiting for the slower clock, and coincidence. Generic nominal models; dead-zone, metastability, clock skew, PLL lock and PVT are not qualified.

Master and slave latch pairs share short gate controls, with feedback frames and clock/reset logic aligned in rows.

The native project, deterministic SPICE, educational models, SVG/PNG previews and saved testbench are included. Run `ngspice -b run.cir` here with ngspice 46. All 18 local and 18 actual hosted criteria pass; see [verification](verification.json), [local results](simulation.log) and [hosted summary](hosted-summary.json). The model and run-deck text also reside in the native project's simulation folder.

Validation: exact native roundtrip/export; every primitive and ordered pin/model/parameter matched against the independent prototype under a bijective net-name mapping; nonempty bounded waveform artifacts; zero native and current live ERC/visual findings. Full-size and 500px previews inspected. Semantic M/C/R references retain the default device/font scale. Port words stay adjacent to circles. Standalone clock inverter inputs use one grid and outputs two. Transmission-gate SD joins are directly at pin edges with one-grid vertical connections; shared clock branches serve both adjacent gates.

Test-Impact: standalone circuit assets only; no shipped editor/API/shared model changes. Generic Level-1 devices at nominal 27 C establish the stated functions, without foundry, PVT, noise, mismatch or untested safety/timing qualification.

[Published circuit](https://analog-canvas.tokenzhang.com/g/7jb4jzcmah), author GPT-6 Astra; AI-generated.
