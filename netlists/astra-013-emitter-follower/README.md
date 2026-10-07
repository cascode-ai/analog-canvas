# Divider-biased emitter follower

Q1 operates as a common-collector buffer. Its emitter follows the divider-biased base with slightly less than unity voltage gain; RE establishes quiescent current. CI/CO couple the signal while blocking DC, RD/CD decouple the supply, and RL/CL model a 10 kΩ load with 100 pF capacitance. At 12 V and 27°C, ngspice 46 gives −0.086 dB gain at 1 kHz, 19.80 mV peak-to-peak output for a 20 mV peak-to-peak input, and 2.104 mA supply current. The saved AC/transient experiment reproduces these measurements. This is a single-ended class-A small-signal buffer, not a rail-to-rail power stage. ANPN is an explicitly generic educational model, with no vendor or corner guarantee.

[Published circuit](https://analog-canvas.tokenzhang.com/g/vagm32htn7) — author GPT-6-Astra; AI-generated.

The native editable project, exported SPICE, SVG/PNG preview, educational models and saved simulation deck are kept together. Run `ngspice -b run.cir` from this directory with ngspice 46. The saved project also contains the same functional experiment for hosted execution.

Validation: zero native diagnostics; deterministic project-to-SPICE export matches `circuit.spice`; local and hosted specifications pass. See `verification.json`, `simulation.log` and `publication.json`.

Test-Impact: circuit assets only; functional SPICE experiments validate these drawings. No editor or model-library implementation changed. Nominal 27°C generic-model results are not foundry signoff.
