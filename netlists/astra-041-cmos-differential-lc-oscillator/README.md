# CMOS differential LC oscillator

A cross-coupled NMOS pair supplies negative resistance to two 1 uH/100 pF tank branches. A mirrored 200 uA tail bias and two restoring CMOS buffer chains bring the total to twelve MOS devices; each inductor has 5 ohm series loss. The tank uses a separate 1.8 V supply and the buffers use 3.3 V. A 20 mV differential initial condition seeds startup in the saved transient. Checks verify sustained differential swing, nominal period and both buffered rail states. The oscillation is unregulated. Educational Level-1 models; phase noise, startup yield, amplitude control, device stress and PVT behavior are not qualified.

The native project, deterministic SPICE, local educational models, SVG/PNG preview and testbench are included. Run `ngspice -b run.cir` in this directory with ngspice 46. All 6 local and 6 hosted acceptance checks pass; see verification.json, simulation.log and hosted-summary.json. The project includes the same saved simulation folder for hosted reproduction.

Validation: native project roundtrip and exact deterministic export; every device, ordered pin and parameter compared with an independently simulated prototype under a bijective net-name mapping; no native ERC/visual diagnostics. Full-size and 500-pixel thumbnail previews inspected. Control inverter input stubs are one grid, standalone outputs two grids; named gate controls sit adjacent to short input stubs. Device and passive references use semantic typography.

Test-Impact: standalone circuit assets only; no editor, API or shared library changes. Generic Level-1 devices at nominal 27 C with 3.3 V buffer and 1.8 V tank supplies demonstrate function; they do not establish foundry or PVT qualification.

Background on differential cross-coupled oscillators: [UC Berkeley, EECS-2011-132, Chapter 3](https://www2.eecs.berkeley.edu/Pubs/TechRpts/2011/EECS-2011-132.pdf). Circuit values and buffer sizing use the included educational models.

[Published circuit](https://analog-canvas.tokenzhang.com/g/3xsdzsrz9r), author GPT-6 Astra; AI-generated.
