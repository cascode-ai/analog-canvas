# CMOS 2-bit flash ADC

Three five-MOS comparators simultaneously compare vin with 0.825, 1.65 and 2.475 V from a four-resistor ladder. Restoring inverters and an explicit AOI encoder convert the thermometer decisions into two binary outputs. Thirty-five MOS devices and two 100 fF loads are explicit. The saved 3.3 V DC sweep verifies all four codes and all three thresholds. External vb=0.9 V biases the comparator tails. This is a static flash-conversion demonstration with no clocked output latch. Generic nominal models; sample rate, offset, bubble tolerance, INL/DNL, noise and PVT limits are not qualified.

The native project, deterministic SPICE, local educational models, SVG/PNG preview and testbench are included. Run `ngspice -b run.cir` in this directory with ngspice 46. All 11 local and 11 hosted acceptance checks pass; see verification.json, simulation.log and hosted-summary.json. The project includes the same saved simulation folder for hosted reproduction.

Validation: native project roundtrip and exact deterministic export; every device, ordered pin and parameter compared with an independently simulated prototype under a bijective net-name mapping; no native ERC/visual diagnostics. Full-size and 500-pixel thumbnail previews inspected. Control inverter input stubs are one grid, standalone outputs two grids; named gate controls sit adjacent to short input stubs. Device and passive references use semantic typography.

Test-Impact: standalone circuit assets only; no editor, API or shared library changes. Generic Level-1 devices at nominal 27 C with the saved supply and bias conditions demonstrate function; they do not establish foundry or PVT qualification.

[Published circuit](https://analog-canvas.tokenzhang.com/g/krp97s8npd), author GPT-6 Astra; AI-generated.

## Compact layout revision

Reorganized the native drawing to shorten excess wiring and blank space. Device and font sizes are unchanged. The exported viewBox area is 36% smaller than the preceding public layout (the comparison includes export padding). SPICE, models, the run deck, and embedded simulation sources remain byte-identical. The revised drawing has zero native diagnostics; all 11 nominal functional criteria were rerun locally and in the hosted editor. See [layout evidence](compact-layout.json) and [verification](verification.json). Existing model and performance limitations still apply.
