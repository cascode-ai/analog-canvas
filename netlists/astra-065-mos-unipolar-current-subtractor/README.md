# MOS unipolar current-subtraction cell

An NMOS mirror and PMOS mirror source a copy of i1 into the output, while a second NMOS mirror sinks i2. A 50 kohm load develops an approximate positive current difference; a larger opposing current drives the output toward zero. Six MOS devices and a 1 pF load are explicit. Four input-current pairs test two positive differences and two clamped cases. Educational nominal models; this is not a precision arithmetic element, and mirror error, output compliance, negative-case offset and PVT are not qualified.

Layout draws each mirror as a short facing pair with a straight reference-current leg.

The native project, deterministic SPICE, educational local models, SVG/PNG preview and saved testbench are included. Run `ngspice -b run.cir` in this directory with ngspice 46. All 4 local and 4 hosted criteria pass; see [verification](verification.json), [local results](simulation.log), and [hosted summary](hosted-summary.json). The same model and run-deck text is stored in the project's simulation folder.

Validation: exact native roundtrip/export; every primitive, ordered pin, model and parameter matched to the independently simulated prototype under a bijective net-name mapping; actual nonempty waveform artifacts; no native ERC/visual diagnostics. Full-size and 500-pixel previews inspected. Device and passive references retain semantic typography, port labels sit next to their circles.

Test-Impact: standalone circuit assets only; no editor, API, shared component or model changes. Generic Level-1 devices at nominal 27 C demonstrate the specified functions; no foundry, PVT, noise, mismatch or untested timing qualification is implied.

[Published circuit](https://analog-canvas.tokenzhang.com/g/g3f4zgqqeb), author GPT-6 Astra; AI-generated.
