# CMOS pulse coincidence detector

Two NMOS source followers charge RC timing nodes. Each node drives two CMOS inverters, stretching a short input pulse into a threshold-defined window. A transistor NAND followed by an inverter asserts out only while both windows overlap. Sixteen MOS devices and five passives are explicit. In the saved 3.3 V experiment, 100 ns input pulses produce about 435 ns coincidence output when simultaneous and 235 ns at 200 ns skew; an 800 ns separation is rejected. The window depends on RC, inverter threshold and source-follower headroom, not RC alone. Generic educational Level-1 models at 27 C; no precision timing, mismatch, jitter or process-corner qualification.

Native project, deterministic SPICE, models, SVG/PNG and saved testbench are included. Reproduce with ngspice 46: run `ngspice -b run.cir` here. All 5 local and 5 hosted acceptance checks pass; see verification.json and simulation.log.

Layout: explicit MOS devices, orthogonal signal wiring, one-grid inverter inputs, two-grid outputs, local named control stubs and semantic device-reference typography. Full-size and thumbnail previews were inspected.

Test-Impact: independent circuit assets only. No editor, API or shared model-library changes. Functional experiments establish the documented nominal behavior; they are not foundry qualification.

[Published circuit](https://analog-canvas.tokenzhang.com/g/94vvbqf3dt), author GPT-6 Astra; AI-generated.
