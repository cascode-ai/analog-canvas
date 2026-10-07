# CMOS two-phase non-overlap clock generator

Two cross-interlocked transistor NOR networks generate complementary clock phases. Each phase feeds a two-inverter delay path back to the opposite NOR; 200 fF delay capacitors create break-before-make timing. An additional inverter generates clkb, giving 18 explicit MOS devices. The saved 3.3 V experiment with 100 ps clock edges and 100 fF phase loads checks both output levels, both transition dead times and simultaneous-high overlap. Nominal dead time is about 0.31 ns, measured at half supply. This is a functional switched-capacitor clock example, not a guaranteed dead-time cell: loading, clock slew and device variation change the interval. Generic educational Level-1 models at 27 C; no PVT or jitter qualification.

Native project, deterministic SPICE, models, SVG/PNG and saved testbench are included. Reproduce with ngspice 46: run `ngspice -b run.cir` here. All 5 local and 5 hosted acceptance checks pass; see verification.json and simulation.log.

Layout: explicit MOS devices, orthogonal signal wiring, one-grid inverter inputs, two-grid outputs, local named control stubs and semantic device-reference typography. Full-size and thumbnail previews were inspected.

Test-Impact: independent circuit assets only. No editor, API or shared model-library changes. Functional experiments establish the documented nominal behavior; they are not foundry qualification.

[Published circuit](https://analog-canvas.tokenzhang.com/g/jjajtjwtme), author GPT-6 Astra; AI-generated.
