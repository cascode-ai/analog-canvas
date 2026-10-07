# CMOS static set-reset latch

Two cross-coupled CMOS NOR gates store a set/reset state; two inverters buffer Q into a 500 fF output. Twelve MOS devices and three capacitors are explicit. Active-high s sets Q and r resets Q; both low retain the state. Six transient checks cover initial reset, setting, retaining both states, resetting and setting again. Simultaneous s=r=1 is invalid and excluded from the experiment. Educational nominal models; no arbitration, metastability or PVT guarantee.

The native project, deterministic SPICE, local educational models, SVG/PNG preview and testbench are included. Run `ngspice -b run.cir` in this directory with ngspice 46. All 6 local and 6 hosted acceptance checks pass; see verification.json, simulation.log and hosted-summary.json. The project includes the same saved simulation folder for hosted reproduction.

Validation: native project roundtrip and exact deterministic export; every device, ordered pin and parameter compared with an independently simulated prototype under a bijective net-name mapping; no native ERC/visual diagnostics. Full-size and 500-pixel thumbnail previews inspected. Control inverter input stubs are one grid, standalone outputs two grids; named gate controls sit adjacent to short input stubs. Device and passive references use semantic typography.

Test-Impact: standalone circuit assets only; no editor, API or shared library changes. Generic Level-1 devices at 3.3 V and nominal 27 C demonstrate function; they do not establish foundry or PVT qualification.

[Published circuit](https://analog-canvas.tokenzhang.com/g/7ssm8c3hdk), author GPT-6 Astra; AI-generated.
