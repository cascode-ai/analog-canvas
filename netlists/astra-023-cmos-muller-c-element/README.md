# CMOS Muller C-element

A static 14-MOS Muller C-element built from an inverting majority network and a restoring inverter. Output q rises when a and b are both high, falls when both are low, and retains its state while they disagree. Explicit q feedback supplies the third majority input. The saved 3.3 V test checks set, reset, and both mixed-input combinations after both stored states, with a 500 fF output load. Initialization uses a=b=0; simultaneous asynchronous transitions, metastability and PVT timing are not qualified.

The native project, deterministic SPICE, local educational models, SVG/PNG preview and testbench are included. Run `ngspice -b run.cir` in this directory with ngspice 46. All 9 local and 9 hosted acceptance checks pass; see verification.json, simulation.log and hosted-summary.json. The project includes the same saved simulation folder for hosted reproduction.

Validation: native project roundtrip and exact deterministic export; every device, ordered pin and parameter compared with an independently simulated prototype under a bijective net-name mapping; no native ERC/visual diagnostics. Full-size and 500-pixel thumbnail previews inspected. Named gate controls sit adjacent to short input stubs; signal paths and feedback use orthogonal routes. Device and passive references use semantic typography.

Test-Impact: standalone circuit assets only; no editor, API or shared library changes. Generic Level-1 devices at 3.3 V and nominal 27 C demonstrate function; they do not establish foundry or PVT qualification.

[Published circuit](https://analog-canvas.tokenzhang.com/g/8kxwkezf9c), author GPT-6 Astra; AI-generated.

Compact layout revision: reduced redundant spacing between stages and control inverters, with 31.5% less SVG view-box area at unchanged symbol and font size. Electrical files (circuit.spice, models.spice, run.cir) are byte-identical to 5f115451f; local functional checks were rerun and existing hosted evidence remains applicable.
