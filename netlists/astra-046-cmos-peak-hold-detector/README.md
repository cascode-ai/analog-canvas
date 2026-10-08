# CMOS peak-hold detector

A five-MOS comparator turns on a transmission gate whenever vin exceeds a held voltage. Two restoring inverters provide complementary switch controls; a reset NMOS initializes the 10 pF hold capacitor. Twelve MOS devices and a 1 Gohm leakage load are explicit. With vb=0.9 V at 3.3 V, the saved ramp/plateau experiment captures 1.2 V and 1.8 V peaks and retains them as vin falls. This unclocked feedback loop can chatter near equality. Generic nominal models; no precision-peak error, acquisition-time, noise, long-term droop or PVT qualification.

The native project, deterministic SPICE, local educational models, SVG/PNG preview and testbench are included. Run `ngspice -b run.cir` in this directory with ngspice 46. All 4 local and 4 hosted acceptance checks pass; see verification.json, simulation.log and hosted-summary.json. The project includes the same saved simulation folder for hosted reproduction.

Validation: native project roundtrip and exact deterministic export; every device, ordered pin and parameter compared with an independently simulated prototype under a bijective net-name mapping; no native ERC/visual diagnostics. Full-size and 500-pixel thumbnail previews inspected. Control inverter input stubs are one grid, standalone outputs two grids; transmission-gate source/drain branches join directly at pin edges with one-grid vertical spacing. Device and passive references use semantic typography.

Test-Impact: standalone circuit assets only; no editor, API or shared library changes. Generic Level-1 devices at nominal 27 C with the saved supply and bias conditions demonstrate function; they do not establish foundry or PVT qualification.

[Published circuit](https://analog-canvas.tokenzhang.com/g/q3enn9qyjy), author GPT-6 Astra; AI-generated.

## Compact layout revision

Reorganized the native drawing to shorten excess wiring and blank space. Device and font sizes are unchanged. The exported viewBox area is 17% smaller than the preceding public layout (the comparison includes export padding). SPICE, models, the run deck, and embedded simulation sources remain byte-identical. The revised drawing has zero native diagnostics; all 4 nominal functional criteria were rerun locally and in the hosted editor. See [layout evidence](compact-layout.json) and [verification](verification.json). Existing model and performance limitations still apply.
