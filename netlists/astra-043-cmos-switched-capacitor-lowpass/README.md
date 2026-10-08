# CMOS switched-capacitor low-pass filter

Two transmission gates alternately sample vin onto 20 pF and share that charge with a 200 pF output capacitor. Two CMOS inverters provide phase complements: eight MOS devices are explicit. Non-overlapping 1 MHz clocks give an approximate 50 kohm switched-capacitor resistance and 16 kHz cutoff. Two 1 Gohm resistors model leakage. The saved transient applies simultaneous 10 kHz and 100 kHz tones around 1.2 V; coherent in-phase/quadrature averages verify passband transfer, stronger high-frequency attenuation and DC level. This sampled filter also creates clock harmonics. Generic nominal models; no anti-alias, noise, distortion or PVT qualification.

The native project, deterministic SPICE, local educational models, SVG/PNG preview and testbench are included. Run `ngspice -b run.cir` in this directory with ngspice 46. All 5 local and 5 hosted acceptance checks pass; see verification.json, simulation.log and hosted-summary.json. The project includes the same saved simulation folder for hosted reproduction.

Validation: native project roundtrip and exact deterministic export; every device, ordered pin and parameter compared with an independently simulated prototype under a bijective net-name mapping; no native ERC/visual diagnostics. Full-size and 500-pixel thumbnail previews inspected. Control inverter input stubs are one grid, standalone outputs two grids; transmission-gate source/drain branches join directly at pin edges with one-grid vertical spacing. Device and passive references use semantic typography.

Test-Impact: standalone circuit assets only; no editor, API or shared library changes. Generic Level-1 devices at nominal 27 C with the saved supply and bias conditions demonstrate function; they do not establish foundry or PVT qualification.

Topology background: [Analog Devices AN-282, Fundamentals of Sampled Data Systems](https://www.analog.com/media/en/technical-documentation/application-notes/an-282.pdf). Included MOS sizing and measurements are educational nominal examples.

[Published circuit](https://analog-canvas.tokenzhang.com/g/k8d5qngsf6), author GPT-6 Astra; AI-generated.
