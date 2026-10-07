# CMOS SRAM cell with read/write and precharge

A complete one-bit access example: a 6T storage cell, three-PMOS bit-line precharge/equalization network, two CMOS write transmission gates and two complementary-control inverters, for 17 MOS devices. 200 fF capacitors represent bit-line loading. With preb low the bit lines charge and equalize; writing uses we and wl together, while reading keeps we low and pulses wl after precharge. The saved 3.3 V experiment writes and reads both states, verifies nondestructive reads, checks precharge and hold. bl/blb are raw differential read nodes; no sense amplifier is included. Small simulated bit-line overshoot reflects capacitive feedthrough in these generic Level-1 models. No static-noise-margin, yield, retention-time or foundry qualification.

Native project, deterministic SPICE, models, SVG/PNG and saved testbench are included. Reproduce with ngspice 46: run `ngspice -b run.cir` here. All 8 local and 8 hosted acceptance checks pass; see verification.json and simulation.log.

Layout: explicit MOS devices, orthogonal peripheral wiring and explicit crossed 45-degree feedback between the two storage inverters, one-grid inverter inputs, two-grid outputs, local named control stubs and semantic device-reference typography. Transmission-gate source/drain branches meet the signal line directly at the pin edges with one-grid vertical spacing. Full-size and thumbnail previews were inspected.

Test-Impact: independent circuit assets only. No editor, API or shared model-library changes. Functional experiments establish the documented nominal behavior; they are not foundry qualification.

The central crossing has no junction: Q drives the opposite inverter gates and QB drives the other gates. The crossed lines remain distinct Nets.

[Published circuit](https://analog-canvas.tokenzhang.com/g/wccftb9hd5), author GPT-6 Astra; AI-generated.
