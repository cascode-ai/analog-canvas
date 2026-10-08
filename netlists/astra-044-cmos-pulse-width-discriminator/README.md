# CMOS pulse-width discriminator

A PMOS mirror charges a 1 pF timing capacitor while inp is high; an NMOS resets it while inp is low. A five-MOS comparator checks the ramp against 1.2 V, and CMOS logic qualifies the decision with inp. Seventeen MOS devices are explicit. With 100 uA reference, out asserts after roughly 14 ns only while a long pulse remains high. The experiment rejects 5/7 ns pulses, accepts 30/40 ns pulses and checks delay, output width and reset. External 0.9 V tail bias is required. Educational nominal models; no calibrated timing, jitter, metastability or PVT guarantee.

The native project, deterministic SPICE, local educational models, SVG/PNG preview and testbench are included. Run `ngspice -b run.cir` in this directory with ngspice 46. All 7 local and 7 hosted acceptance checks pass; see verification.json, simulation.log and hosted-summary.json. The project includes the same saved simulation folder for hosted reproduction.

Validation: native project roundtrip and exact deterministic export; every device, ordered pin and parameter compared with an independently simulated prototype under a bijective net-name mapping; no native ERC/visual diagnostics. Full-size and 500-pixel thumbnail previews inspected. Control inverter input stubs are one grid, standalone outputs two grids; named gate controls sit adjacent to short input stubs. Device and passive references use semantic typography.

Test-Impact: standalone circuit assets only; no editor, API or shared library changes. Generic Level-1 devices at nominal 27 C with the saved supply and bias conditions demonstrate function; they do not establish foundry or PVT qualification.

[Published circuit](https://analog-canvas.tokenzhang.com/g/hty6kq32jb), author GPT-6 Astra; AI-generated.

## Compact layout revision

Reorganized the native drawing to shorten excess wiring and blank space. Device and font sizes are unchanged. The exported viewBox area is 17% smaller than the preceding public layout (the comparison includes export padding). SPICE, models, the run deck, and embedded simulation sources remain byte-identical. The revised drawing has zero native diagnostics; all 7 nominal functional criteria were rerun locally and in the hosted editor. See [layout evidence](compact-layout.json) and [verification](verification.json). Existing model and performance limitations still apply.
