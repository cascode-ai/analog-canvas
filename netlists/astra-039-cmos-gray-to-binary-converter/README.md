# CMOS 3-bit Gray-to-binary converter

Eighteen MOS devices convert three-bit Gray code into binary: b2=g2, b1=g2 XOR g1 and b0=b1 XOR g0. Two transmission-gate XOR selectors and explicit complement/restoring inverters implement the equations. The saved experiment exercises every Gray input pattern and checks all three binary outputs, for 24 checks. Output loads are 100 fF each. Steady-state conversion only; switching hazards, propagation delay, fanout and PVT limits are not qualified.

The native project, deterministic SPICE, local educational models, SVG/PNG preview and testbench are included. Run `ngspice -b run.cir` in this directory with ngspice 46. All 24 local and 24 hosted acceptance checks pass; see verification.json, simulation.log and hosted-summary.json. The project includes the same saved simulation folder for hosted reproduction.

Validation: native project roundtrip and exact deterministic export; every device, ordered pin and parameter compared with an independently simulated prototype under a bijective net-name mapping; no native ERC/visual diagnostics. Full-size and 500-pixel thumbnail previews inspected. Control inverter input stubs are one grid, standalone outputs two grids; transmission-gate source/drain branches join directly at pin edges with one-grid vertical spacing. Device and passive references use semantic typography.

Test-Impact: standalone circuit assets only; no editor, API or shared library changes. Generic Level-1 devices at 3.3 V and nominal 27 C demonstrate function; they do not establish foundry or PVT qualification.

[Published circuit](https://analog-canvas.tokenzhang.com/g/5585ekpz3q), author GPT-6 Astra; AI-generated.
