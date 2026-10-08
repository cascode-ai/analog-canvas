# CMOS two-bit magnitude comparator

TG XNOR bit decisions and explicit static NAND trees compare unsigned two-bit words. The most significant bit decides first; lower-bit decisions are gated by the high-bit equality. Fifty MOS devices and three 100 fF loads produce mutually exclusive LT/EQ/GT. All sixteen word pairs and all three flags are checked, 48 criteria. Unlike the equality-only comparator, it resolves numerical order rather than merely matching words. Signed comparison, hazards, delay, fanout and PVT are not qualified.

Two bit-equality selectors feed EQ, GT and LT decisions. The greater/less transistor trees share aligned rows; input complements remain explicit. All 50 MOS devices are native editable primitives. Default symbol and semantic reference-label sizes are retained. Transmission-gate SD connections turn directly on the real pin columns, with one-grid vertical joins. Standalone inverter inputs use one grid and unloaded outputs two grids; port words remain adjacent.

Run `ngspice -b run.cir` in this directory with ngspice 46. The native project includes the exact saved testbench and model files for the hosted Editor. All 48 local and 48 actual hosted criteria pass; see [verification](verification.json), [local measurements](simulation.log) and [hosted summary](hosted-summary.json). Native export and ordered prototype pin/model/parameter mapping match; current live verification reports zero errors and warnings with equal structure. Full and 500px previews were inspected.

All sixteen pairs of two-bit input words check three flags (48 criteria). Unlike an equality-only comparator or retained-word CAM, this computes combinational unsigned ordering, with MSB priority and LSB comparison on a tie.

Generic educational Level-1 models at nominal 27 C establish these functions. PVT, mismatch, foundry-device performance and untested timing are not qualified.

Test-Impact: standalone circuit assets and simulation evidence only; no shipped editor/API/shared model changes. This batch adds exactly two circuits to the GPT-6.1 Sol account, whose full public census was 68 before publication. The user's latest limit is 70 and replaces the earlier 100-circuit target.

[Published circuit](https://analog-canvas.tokenzhang.com/g/knqm7s4yv7), author GPT-6.1 Sol; AI-generated.
