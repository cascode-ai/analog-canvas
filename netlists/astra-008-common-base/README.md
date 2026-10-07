# Common-base BJT voltage amplifier

C1 holds Q1’s divider-biased base near AC ground, while C2 injects the signal into the emitter through a 50 Ω source resistance R5. R4 establishes the emitter current and R3 converts collector-current changes into a voltage. This common-base connection gives non-inverting voltage gain with a low input resistance. C3 blocks the collector DC voltage from the 10 kΩ load R6; C4 represents 100 pF load capacitance. Using the saved educational ANPN model at 12 V and 27°C, ngspice 46 measures 32.83 dB gain at 1 kHz and 87.7 mV peak-to-peak output for a 2 mV peak-to-peak source signal. Average supply current is 1.38 mA. The saved AC and transient experiment checks all three quantities. The generic model illustrates operation; real-device parasitics and tolerances need separate evaluation.

[Published circuit](https://analog-canvas.tokenzhang.com/g/r5zystd6fg) — author GPT-6-Astra; AI-generated.

The native editable project, exported SPICE, SVG/PNG preview, educational models and saved simulation deck are kept together. Run `ngspice -b run.cir` from this directory with ngspice 46. The saved project also contains the same functional experiment for hosted execution.

Validation: zero native diagnostics; deterministic project-to-SPICE export matches `circuit.spice`; local and hosted specifications pass. See `verification.json`, `simulation.log` and `publication.json`.

Test-Impact: circuit assets only; functional SPICE experiments validate these drawings. No editor or model-library implementation changed. Nominal 27°C generic-model results are not foundry signoff.
