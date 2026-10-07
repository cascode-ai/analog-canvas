# Darlington common-emitter voltage amplifier

Q1 and Q2 share a collector load and form a Darlington common-emitter stage. Q1 supplies Q2’s base current, increasing input resistance; R3 provides a discharge and bias path at the intermediate base. R1/R2 establish input bias, while R4 stabilizes DC emitter current and C2 bypasses it at signal frequencies. R5 sets collector loading, C1/C3 block DC, and R6/C4 represent a 10 kΩ load with 100 pF capacitance. At 12 V and 27°C, ngspice 46 gives 40.30 dB gain at 1 kHz, 207.0 mV peak-to-peak output for a 2 mV peak-to-peak input and 0.953 mA supply current. Open the saved Functional verification experiment to reproduce AC and transient results. ANPN is a generic educational model; device spread, tolerances and process corners are not qualified.

[Published circuit](https://analog-canvas.tokenzhang.com/g/chhjkqjr9g) — author GPT-6-Astra; AI-generated.

The native editable project, exported SPICE, SVG/PNG preview, educational models and saved simulation deck are kept together. Run `ngspice -b run.cir` from this directory with ngspice 46. The saved project also contains the same functional experiment for hosted execution.

Validation: zero native diagnostics; deterministic project-to-SPICE export matches `circuit.spice`; local and hosted specifications pass. See `verification.json`, `simulation.log` and `publication.json`.

Test-Impact: circuit assets only; functional SPICE experiments validate these drawings. No editor or model-library implementation changed. Nominal 27°C generic-model results are not foundry signoff.
