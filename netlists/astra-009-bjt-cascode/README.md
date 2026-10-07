# BJT cascode voltage amplifier

Q1 is a common-emitter input stage stacked beneath common-base Q2. The upper transistor limits the voltage swing at Q1’s collector, reducing collector-to-base feedback, while R6 converts the signal current into output voltage. R1/R2 and R4/R5 bias the two bases; C2 and C3 hold the emitter and upper base near AC ground. C1/C4 provide coupling, and R7/C5 model a 10 kΩ load with 100 pF capacitance. At 12 V and 27°C, ngspice 46 gives 41.42 dB gain at 1 kHz, 235.4 mV peak-to-peak output for a 2 mV peak-to-peak input and 1.467 mA supply current. The saved AC/transient experiment reproduces these measurements. Both BJTs use the explicit educational ANPN model; no vendor-device, tolerance or process-corner performance is claimed.

[Published circuit](https://analog-canvas.tokenzhang.com/g/q2fjjxhw6r) — author GPT-6-Astra; AI-generated.

The native editable project, exported SPICE, SVG/PNG preview, educational models and saved simulation deck are kept together. Run `ngspice -b run.cir` from this directory with ngspice 46. The saved project also contains the same functional experiment for hosted execution.

Validation: zero native diagnostics; deterministic project-to-SPICE export matches `circuit.spice`; local and hosted specifications pass. See `verification.json`, `simulation.log` and `publication.json`.

Test-Impact: circuit assets only; functional SPICE experiments validate these drawings. No editor or model-library implementation changed. Nominal 27°C generic-model results are not foundry signoff.
