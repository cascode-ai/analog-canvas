# CMOS 2-bit Johnson counter

Two static master/slave D flip-flops share a clock inverter and feed back inverse Q1 into the first stage. Thirty-six MOS devices implement the four-state cycle (q1q0)=00→01→11→10→00. With a 40 ns input period, both outputs repeat after 160 ns and their rising edges are 40 ns apart. Four capacitors load the master/storage outputs. The saved initialized transient checks two full state cycles, period, high duration and phase. Initial Q0=Q1=0 sets simulation phase; no hardware reset is included. Educational nominal models; clock-tree, setup/hold, metastability, startup phase and PVT limits are not qualified.

The native project, deterministic SPICE, local educational models, SVG/PNG preview and testbench are included. Run `ngspice -b run.cir` in this directory with ngspice 46. All 19 local and 19 hosted acceptance checks pass; see verification.json, simulation.log and hosted-summary.json. The project includes the same saved simulation folder for hosted reproduction.

Validation: native project roundtrip and exact deterministic export; every device, ordered pin and parameter compared with an independently simulated prototype under a bijective net-name mapping; no native ERC/visual diagnostics. Full-size and 500-pixel thumbnail previews inspected. Control inverter input stubs are one grid, standalone outputs two grids; transmission-gate source/drain branches join directly at pin edges with one-grid vertical spacing. Device and passive references use semantic typography.

Test-Impact: standalone circuit assets only; no editor, API or shared library changes. Generic Level-1 devices at nominal 27 C with the saved supply and bias conditions demonstrate function; they do not establish foundry or PVT qualification.

[Published circuit](https://analog-canvas.tokenzhang.com/g/svavdb3j9w), author GPT-6 Astra; AI-generated.

## Compact layout revision

Reorganized the native drawing to shorten excess wiring and blank space. Device and font sizes are unchanged. The exported viewBox area is 28% smaller than the preceding public layout (the comparison includes export padding). SPICE, models, the run deck, and embedded simulation sources remain byte-identical. The revised drawing has zero native diagnostics; all 19 nominal functional criteria were rerun locally and in the hosted editor. See [layout evidence](compact-layout.json) and [verification](verification.json). Existing model and performance limitations still apply.
