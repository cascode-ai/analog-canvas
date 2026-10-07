# CMOS UP/DOWN charge pump

Ten MOS devices form mirrored source and sink paths, a complementary UP driver and reset switch. A 10 uA external reference programs both nominal currents; UP adds charge to a 20 pF capacitor and DN removes it. A 1 Gohm load models leakage. The saved transient checks reset, charging, discharging, hold intervals and simultaneous-UP/DN behavior. This is an educational PLL charge-pump building block, not a complete PLL; current matching, output compliance, dead zone and PVT performance are not qualified.

The native project, deterministic SPICE, local educational models, SVG/PNG preview and testbench are included. Run `ngspice -b run.cir` in this directory with ngspice 46. All 8 local and 8 hosted acceptance checks pass; see verification.json, simulation.log and hosted-summary.json. The project includes the same saved simulation folder for hosted reproduction.

Validation: native project roundtrip and exact deterministic export; every device, ordered pin and parameter compared with an independently simulated prototype under a bijective net-name mapping; no native ERC/visual diagnostics. Full-size and 500-pixel thumbnail previews inspected. Control inverter input stubs are one grid, standalone outputs two grids; named gate controls sit adjacent to short input stubs. Device and passive references use semantic typography.

Test-Impact: standalone circuit assets only; no editor, API or shared library changes. Generic Level-1 devices at 3.3 V and nominal 27 C demonstrate function; they do not establish foundry or PVT qualification.

Background on source/sink PLL charge pumps: [Analog Devices, Phase-Lock Loop Applications Using the MAX9382](https://www.analog.com/en/resources/technical-articles/phaselock-loop-applications-using-the-max9382.html). This example uses independently authored educational MOS sizing.

[Published circuit](https://analog-canvas.tokenzhang.com/g/2qhvsznmqs), author GPT-6 Astra; AI-generated.
