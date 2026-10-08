# MOS Gilbert double-balanced mixer

A seven-NMOS Gilbert cell combines a differential RF transconductance pair, LO switching quad and tail-current device. Two 10 kohm loads and two 100 fF loads develop differential output. The saved 100 kHz RF / 1 MHz LO experiment checks coherent projections at 900 kHz and 1.1 MHz, RF/LO feedthrough, and common-mode bias. Every transistor is explicit. Generic educational models; no RF noise, linearity, matching, power-gain, impedance or PVT qualification.

The native project, deterministic SPICE, educational local models, SVG/PNG preview and saved testbench are included. Run `ngspice -b run.cir` in this directory with ngspice 46. All 7 local and 7 hosted criteria pass; see [verification](verification.json), [local results](simulation.log), and [hosted summary](hosted-summary.json). The same model and run-deck text is stored in the project's simulation folder. The coherent sine/cosine averages are half the corresponding peak Fourier coefficients; they are not a claim of power gain.

Validation: exact native roundtrip/export; every primitive, ordered pin, model and parameter matched to the independently simulated prototype under a bijective net-name mapping; actual nonempty waveform artifacts; no native ERC/visual diagnostics. Full-size and 500-pixel previews inspected. Device and passive references retain semantic typography, port labels sit next to their circles.

Test-Impact: standalone circuit assets only; no editor, API, shared component or model changes. Generic Level-1 devices at nominal 27 C demonstrate the specified functions; no foundry, PVT, noise, mismatch or untested timing qualification is implied.

[Published circuit](https://analog-canvas.tokenzhang.com/g/hcbrrwzqgp), author GPT-6 Astra; AI-generated.
