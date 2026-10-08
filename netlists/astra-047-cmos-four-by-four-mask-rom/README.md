# CMOS 4-by-4 NOR mask ROM

Four precharge PMOS devices, nine hard-wired NMOS cells and four output inverters implement a 4-by-4 NOR mask ROM, for twenty-one MOS devices. The words are 0xA, 0x6, 0xD, 0x3; b0 is the least-significant bit. A present pulldown cell stores 1. With preb low all word lines must be low; after precharge, preb rises and one word line selects a word. Four 100 fF bitline capacitors retain the dynamic state. The saved test checks all 16 read bits plus four precharge outputs. No address decoder is hidden: w0–w3 are external one-hot word lines. Educational nominal models; no retention-time, read-margin, glitch or PVT guarantee.

The native project, deterministic SPICE, local educational models, SVG/PNG preview and testbench are included. Run `ngspice -b run.cir` in this directory with ngspice 46. All 20 local and 20 hosted acceptance checks pass; see verification.json, simulation.log and hosted-summary.json. The project includes the same saved simulation folder for hosted reproduction.

Validation: native project roundtrip and exact deterministic export; every device, ordered pin and parameter compared with an independently simulated prototype under a bijective net-name mapping; no native ERC/visual diagnostics. Full-size and 500-pixel thumbnail previews inspected. Control inverter input stubs are one grid, standalone outputs two grids; named gate controls sit adjacent to short input stubs. Device and passive references use semantic typography.

Test-Impact: standalone circuit assets only; no editor, API or shared library changes. Generic Level-1 devices at nominal 27 C with the saved supply and bias conditions demonstrate function; they do not establish foundry or PVT qualification.

[Published circuit](https://analog-canvas.tokenzhang.com/g/ftwkb7psam), author GPT-6 Astra; AI-generated.

## Compact layout revision

Reorganized the native drawing to shorten excess wiring and blank space. Device and font sizes are unchanged. The exported viewBox area is 17% smaller than the preceding public layout (the comparison includes export padding). SPICE, models, the run deck, and embedded simulation sources remain byte-identical. The revised drawing has zero native diagnostics; all 20 nominal functional criteria were rerun locally and in the hosted editor. See [layout evidence](compact-layout.json) and [verification](verification.json). Existing model and performance limitations still apply.
