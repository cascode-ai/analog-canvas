# MOS bootstrapped track-and-hold switch

A 10 pF bootstrap capacitor is precharged through an NMOS while its bottom plate is clamped. During track a transmission gate connects the bottom to vin and a PMOS connects the lifted top to the main NMOS gate; an NMOS resets that gate during hold. Seven MOS devices, a 5 pF output load and a 1 Gohm leakage load are explicit. The bootstrap PMOS body is explicitly tied to its floating top node t. External sample/sampleb controls are complementary. Three input levels and two hold intervals are checked, along with lifted gate voltage. Educational models only; above-supply gate/body voltages, oxide limits, body-diode transients, retention and foundry/PVT qualification are not guaranteed.

The native project, deterministic SPICE, educational local models, SVG/PNG preview and saved testbench are included. Run `ngspice -b run.cir` in this directory with ngspice 46. All 8 local and 8 hosted criteria pass; see [verification](verification.json), [local results](simulation.log), and [hosted summary](hosted-summary.json). The same model and run-deck text is stored in the project's simulation folder. The bootstrap PMOS body uses the floating top node, not a fixed-supply default; the model experiment does not establish oxide or well safety.

Validation: exact native roundtrip/export; every primitive, ordered pin, model and parameter matched to the independently simulated prototype under a bijective net-name mapping; actual nonempty waveform artifacts; no native ERC/visual diagnostics. Full-size and 500-pixel previews inspected. Device and passive references retain semantic typography, port labels sit next to their circles. Transmission-gate source/drain branches join directly at pin edges with one-grid vertical spacing.

Test-Impact: standalone circuit assets only; no editor, API, shared component or model changes. Generic Level-1 devices at nominal 27 C demonstrate the specified functions; no foundry, PVT, noise, mismatch or untested timing qualification is implied.

[Published circuit](https://analog-canvas.tokenzhang.com/g/67rqtgyyme), author GPT-6 Astra; AI-generated.
