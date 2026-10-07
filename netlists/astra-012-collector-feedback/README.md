# Collector-feedback BJT amplifier

RB biases the base from the collector, creating negative DC feedback: increased collector current lowers the collector voltage and reduces base drive. RE adds emitter degeneration. CI and CO isolate the input and load DC levels; RD/CD filter the supply, and RL/CL represent a 10 kΩ load with 100 pF capacitance. With 12 V at 27°C, ngspice 46 gives 9.689 dB gain at 1 kHz, 6.102 mV peak-to-peak output for a 2 mV peak-to-peak input and 1.556 mA supply current. The saved experiment includes AC and transient checks. The explicit ANPN model is educational and generic; transistor spread, component tolerances and temperature extremes are not qualified.

[Published circuit](https://analog-canvas.tokenzhang.com/g/v37n5t5cee) — author GPT-6-Astra; AI-generated.

The native editable project, exported SPICE, SVG/PNG preview, educational models and saved simulation deck are kept together. Run `ngspice -b run.cir` from this directory with ngspice 46. The saved project also contains the same functional experiment for hosted execution.

Validation: zero native diagnostics; deterministic project-to-SPICE export matches `circuit.spice`; local and hosted specifications pass. See `verification.json`, `simulation.log` and `publication.json`.

Test-Impact: circuit assets only; functional SPICE experiments validate these drawings. No editor or model-library implementation changed. Nominal 27°C generic-model results are not foundry signoff.
