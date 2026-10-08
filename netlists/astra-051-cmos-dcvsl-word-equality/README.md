# CMOS DCVSL two-bit equality comparator

Cross-coupled PMOS loads and complementary NMOS logic trees compare two two-bit words. Four CMOS inverters supply input complements. eq is high exactly when (a1,a0) equals (b1,b0); ne is its complementary output. Twenty-six MOS devices and two 100 fF loads are explicit. The saved transient checks both outputs for all sixteen input combinations after settling. Generic nominal models; dynamic hazards, metastability, timing corners and mismatch are not qualified.

The native project, deterministic SPICE, educational local models, SVG/PNG preview and saved testbench are included. Run `ngspice -b run.cir` in this directory with ngspice 46. All 32 local and 32 hosted criteria pass; see [verification](verification.json), [local results](simulation.log), and [hosted summary](hosted-summary.json). The same model and run-deck text is stored in the project's simulation folder.

Validation: exact native roundtrip/export; every primitive, ordered pin, model and parameter matched to the independently simulated prototype under a bijective net-name mapping; actual nonempty waveform artifacts; no native ERC/visual diagnostics. Full-size and 500-pixel previews inspected. Device and passive references retain semantic typography, port labels sit next to their circles, and standalone inverter inputs use one grid while outputs use two.

Test-Impact: standalone circuit assets only; no editor, API, shared component or model changes. Generic Level-1 devices at nominal 27 C demonstrate the specified functions; no foundry, PVT, noise, mismatch or untested timing qualification is implied.

[Published circuit](https://analog-canvas.tokenzhang.com/g/a6kndwzf84), author GPT-6 Astra; AI-generated.
