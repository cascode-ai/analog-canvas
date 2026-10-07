# CMOS dynamic latched comparator

An eleven-MOS regenerative comparator with explicit differential input pair, clocked tail, cross-coupled latch and four PMOS precharge devices. clk low precharges both outputs high; clk high evaluates the input difference and regenerates a full-swing decision. For inp greater than inn, on rises relative to op. The saved 3.3 V, 50 MHz experiment alternates +10 mV and -10 mV around 1.65 V common mode, verifies both decisions and reset, and measures about 0.23 ns clock-to-decision delay with 50 fF per output. Outputs are valid only during evaluation; there is no output storage latch. Educational Level-1 MOS models, with no noise, offset, metastability or process-corner qualification.

Native project, deterministic SPICE, models, SVG/PNG and saved testbench are included. Reproduce with ngspice 46: run `ngspice -b run.cir` here. All 5 local and 5 hosted acceptance checks pass; see verification.json and simulation.log.

Layout: explicit MOS devices, orthogonal signal wiring, one-grid inverter inputs, two-grid outputs, local named control stubs and semantic device-reference typography. Full-size and thumbnail previews were inspected.

Test-Impact: independent circuit assets only. No editor, API or shared model-library changes. Functional experiments establish the documented nominal behavior; they are not foundry qualification.

[Published circuit](https://analog-canvas.tokenzhang.com/g/g9snn27kb2), author GPT-6 Astra; AI-generated.
