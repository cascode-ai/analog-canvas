# CMOS two-input analog min/max sorter

A five-MOS comparator and two restoring inverters steer four transmission gates so max follows the larger of vp/vn and min follows the smaller. Seventeen MOS devices, two 1 pF loads and two 1 Gohm leakage loads are explicit. The saved experiment checks both outputs for four ordered input pairs and polarity reversals. This continuously routes the inputs; it does not hold past extrema. Nominal educational models; behavior near equality, switching glitches, source impedance, settling limits and PVT are not qualified.

The native project, deterministic SPICE, educational local models, SVG/PNG preview and saved testbench are included. Run `ngspice -b run.cir` in this directory with ngspice 46. All 8 local and 8 hosted criteria pass; see [verification](verification.json), [local results](simulation.log), and [hosted summary](hosted-summary.json). The same model and run-deck text is stored in the project's simulation folder.

Validation: exact native roundtrip/export; every primitive, ordered pin, model and parameter matched to the independently simulated prototype under a bijective net-name mapping; actual nonempty waveform artifacts; no native ERC/visual diagnostics. Full-size and 500-pixel previews inspected. Device and passive references retain semantic typography, port labels sit next to their circles, and standalone inverter inputs use one grid while outputs use two. The four transmission gates join source/drain at their pin edges with one-grid vertical branches.

Test-Impact: standalone circuit assets only; no editor, API, shared component or model changes. Generic Level-1 devices at nominal 27 C demonstrate the specified functions; no foundry, PVT, noise, mismatch or untested timing qualification is implied.

[Published circuit](https://analog-canvas.tokenzhang.com/g/82d59mhdex), author GPT-6 Astra; AI-generated.
