# CMOS four-input priority encoder

Twenty-six explicit MOS devices implement a four-request priority encoder with d3 highest and d0 lowest. b1/b0 identify the highest asserted request, while valid marks any asserted request; all-zero input gives valid=0 and code 00. The AOI path masks d1 when d2 is asserted. Three 100 fF outputs are checked for all sixteen input patterns, including simultaneous requests. Generic nominal models; asynchronous hazards and timing/PVT limits are not qualified.

The native project, deterministic SPICE, educational local models, SVG/PNG preview and saved testbench are included. Run `ngspice -b run.cir` in this directory with ngspice 46. All 48 local and 48 hosted criteria pass; see [verification](verification.json), [local results](simulation.log), and [hosted summary](hosted-summary.json). The same model and run-deck text is stored in the project's simulation folder.

Validation: exact native roundtrip/export; every primitive, ordered pin, model and parameter matched to the independently simulated prototype under a bijective net-name mapping; actual nonempty waveform artifacts; no native ERC/visual diagnostics. Full-size and 500-pixel previews inspected. Device and passive references retain semantic typography, port labels sit next to their circles, and standalone inverter inputs use one grid while outputs use two.

Test-Impact: standalone circuit assets only; no editor, API, shared component or model changes. Generic Level-1 devices at nominal 27 C demonstrate the specified functions; no foundry, PVT, noise, mismatch or untested timing qualification is implied.

[Published circuit](https://analog-canvas.tokenzhang.com/g/gvjfyp87dj), author GPT-6 Astra; AI-generated.
