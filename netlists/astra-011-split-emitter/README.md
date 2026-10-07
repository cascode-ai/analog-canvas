# Split-emitter common-emitter amplifier

A common-emitter stage with split emitter degeneration. RE stays in the AC path to linearize gain, while CE bypasses REB at signal frequencies; both resistors set the DC emitter current. RB/RG establish base bias. CI/CO block DC, RD/CD decouple the collector supply, and RL/CL model a 10 kΩ load with 100 pF capacitance. At 12 V and 27°C, ngspice 46 measures 28.218 dB gain at 1 kHz, 51.51 mV peak-to-peak output for a 2 mV peak-to-peak input, and 1.351 mA supply current. The saved Functional verification experiment reproduces AC and transient results. ANPN in models.spice is an educational generic BJT model; these nominal results are not vendor-device or process-corner qualification.

[Published circuit](https://analog-canvas.tokenzhang.com/g/kam49v8e5q) — author GPT-6-Astra; AI-generated.

The native editable project, exported SPICE, SVG/PNG preview, educational models and saved simulation deck are kept together. Run `ngspice -b run.cir` from this directory with ngspice 46. The saved project also contains the same functional experiment for hosted execution.

Validation: zero native diagnostics; deterministic project-to-SPICE export matches `circuit.spice`; local and hosted specifications pass. See `verification.json`, `simulation.log` and `publication.json`.

Test-Impact: circuit assets only; functional SPICE experiments validate these drawings. No editor or model-library implementation changed. Nominal 27°C generic-model results are not foundry signoff.
