# MOS common-gate Colpitts oscillator

A common-gate NMOS sustains a Colpitts resonator with 1 uH inductance and a 10/20 pF capacitive divider. A tail NMOS supplies bias; an explicit two-NMOS source follower buffers the tank. Four MOS devices, the 10 ohm series loss and all capacitors are shown. The saved initialized transient checks sustained tank/output amplitude, period and tank mean. The feedback is capacitive, distinct from the cross-coupled differential LC oscillator. Generic educational models; startup yield, amplitude/oxide limits, phase noise, tank loss corners and PVT are not qualified.

Layout keeps the tank, capacitive feedback, and output follower in adjoining columns with short branches.

The native project, deterministic SPICE, educational local models, SVG/PNG preview and saved testbench are included. Run `ngspice -b run.cir` in this directory with ngspice 46. All 4 local and 4 hosted criteria pass; see [verification](verification.json), [local results](simulation.log), and [hosted summary](hosted-summary.json). The same model and run-deck text is stored in the project's simulation folder. Initialized tank/fb monitor nodes seed the nominal oscillation; they do not establish startup yield.

Validation: exact native roundtrip/export; every primitive, ordered pin, model and parameter matched to the independently simulated prototype under a bijective net-name mapping; actual nonempty waveform artifacts; no native ERC/visual diagnostics. Full-size and 500-pixel previews inspected. Device and passive references retain semantic typography, port labels sit next to their circles.

Test-Impact: standalone circuit assets only; no editor, API, shared component or model changes. Generic Level-1 devices at nominal 27 C demonstrate the specified functions; no foundry, PVT, noise, mismatch or untested timing qualification is implied.

[Published circuit](https://analog-canvas.tokenzhang.com/g/ax7ddc9j89), author GPT-6 Astra; AI-generated.
