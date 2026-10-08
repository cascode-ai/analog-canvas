# CMOS domino AO21 gate with keeper

Eight MOS devices implement clocked domino logic out=(a AND b) OR c during evaluation. A clocked PMOS precharges the dynamic node, a clocked NMOS foot enables discharge, a weak PMOS keeper retains its high state, and an explicit inverter restores the output. Two 100 fF loads are shown. All eight input patterns and each precharge output are checked. Inputs are held stable throughout evaluation; no hidden clock or gate is used. Educational nominal models; nonmonotonic input behavior, noise margin, charge sharing and PVT are not qualified.

The native project, deterministic SPICE, educational local models, SVG/PNG preview and saved testbench are included. Run `ngspice -b run.cir` in this directory with ngspice 46. All 16 local and 16 hosted criteria pass; see [verification](verification.json), [local results](simulation.log), and [hosted summary](hosted-summary.json). The same model and run-deck text is stored in the project's simulation folder.

Validation: exact native roundtrip/export; every primitive, ordered pin, model and parameter matched to the independently simulated prototype under a bijective net-name mapping; actual nonempty waveform artifacts; no native ERC/visual diagnostics. Full-size and 500-pixel previews inspected. Device and passive references retain semantic typography, port labels sit next to their circles, and standalone inverter inputs use one grid while outputs use two.

Test-Impact: standalone circuit assets only; no editor, API, shared component or model changes. Generic Level-1 devices at nominal 27 C demonstrate the specified functions; no foundry, PVT, noise, mismatch or untested timing qualification is implied.

[Published circuit](https://analog-canvas.tokenzhang.com/g/52ydz586xg), author GPT-6 Astra; AI-generated.
