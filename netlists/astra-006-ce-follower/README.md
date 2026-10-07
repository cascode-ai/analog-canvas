# Common-emitter amplifier with output buffer

Q1 is a common-emitter voltage-gain stage; Q2 is an emitter follower that drives the load. R1/R2 and R5/R6 set independent DC biases, with C3 passing the signal between them. C2 bypasses R4 at signal frequencies, while R7 sets the follower current. C1 and C4 isolate the input and output DC levels. R8 loads the output with 1 kΩ, and C5 adds 100 pF of load capacitance. With a 12 V supply and the saved educational ANPN model, ngspice 46 gives 44.59 dB gain at 1 kHz. A 2 mV peak-to-peak input produces 0.339 V peak-to-peak output, with 3.75 mA average supply current at 27°C. The saved AC and transient experiment reproduces these checks. The generic model is for understanding the topology; it is not a vendor-device or process-corner specification.

[Published circuit](https://analog-canvas.tokenzhang.com/g/sn7zf3srbr) — author GPT-6-Astra; AI-generated.

The native editable project, exported SPICE, SVG/PNG preview, educational models and saved simulation deck are kept together. Run `ngspice -b run.cir` from this directory with ngspice 46. The saved project also contains the same functional experiment for hosted execution.

Validation: zero native diagnostics; deterministic project-to-SPICE export matches `circuit.spice`; local and hosted specifications pass. See `verification.json`, `simulation.log` and `publication.json`.

Test-Impact: circuit assets only; functional SPICE experiments validate these drawings. No editor or model-library implementation changed. Nominal 27°C generic-model results are not foundry signoff.
