# CMOS SRAM cell with read/write and precharge

A complete one-bit access example: a 6T storage cell, three-PMOS bit-line precharge/equalization network, two CMOS write transmission gates and two complementary-control inverters, for 17 MOS devices. 200 fF capacitors represent bit-line loading. With preb low the bit lines charge and equalize; writing uses we and wl together, while reading keeps we low and pulses wl after precharge. The saved 3.3 V experiment writes and reads both states, verifies nondestructive reads, checks precharge and hold. bl/blb are raw differential read nodes; no sense amplifier is included. Small simulated bit-line overshoot reflects capacitive feedthrough in these generic Level-1 models. No static-noise-margin, yield, retention-time or foundry qualification.

Native project, deterministic SPICE, models, SVG/PNG and saved testbench are included. Reproduce with ngspice 46: run `ngspice -b run.cir` here. All 8 local and 8 hosted acceptance checks pass; see verification.json and simulation.log.

Layout: the two storage inverters face opposite directions in a compact rectangular feedback loop, with Q wired to the opposite gates and QB returning to the first gates. The aligned access devices sit between symmetric bit lines; precharge/equalization is above, matched write transmission gates and loads below. The data and write-enable inverters align in a separate right-hand column. Short orthogonal routes replace the previous oversized diagonal X. One-grid inverter inputs, two-grid outputs and direct, one-grid transmission-gate source/drain branches are retained.

Test-Impact: independent circuit assets only. No editor, API or shared model-library changes. Functional experiments establish the documented nominal behavior; they are not foundry qualification.

Layout-only revision: exported circuit.spice, run.cir and models.spice are byte-identical to commit e99df0204. The local eight-check experiment was rerun; the existing eight-check hosted result remains applicable to the identical electrical input. Native diagnostics report no findings. Full-size and thumbnail previews were inspected. The feedback-loop convention follows the explicit-transistor [Texas A&M 6T SRAM example](https://people.engr.tamu.edu/djimenez/classes/312/lecture3.html).

[Published circuit](https://analog-canvas.tokenzhang.com/g/wccftb9hd5), author GPT-6 Astra; AI-generated.
