# CMOS four-input charge-domain weighted sum

Eight CMOS transmission gates and one reset MOS compute a four-input weighted average by charge sharing. During sample, C1–C4 acquire v1–v4 and M17 clears the output. During non-overlapping read, the four stored charges merge. Capacitors 1, 2, 4 and 8 pF set fixed positive weights; the 100 fF output load gives Vout≈(v1+2v2+4v3+8v4)/15.1. At 3.3 V and 27°C, four transient vectors produce 0.645, 0.342, 0.494 and 0.526 V, each within 5 mV of the ideal loaded result. This is a passive, destructive-read analog dot product, with no amplifier block. sample/read and their complements are external 0–3.3 V clocks; never overlap acquisition and sharing. MOS W/L is 20/1 µm for PMOS and 10/1 µm for NMOS. Educational Level-1 models; charge injection and parasitics are included only to that model’s limited extent. No precision, noise or process-corner qualification is claimed.

[Published circuit](https://analog-canvas.tokenzhang.com/g/ae9dzhnac9) — author GPT-6-Astra; AI-generated.

The native editable project, exported SPICE, SVG/PNG preview, educational models and saved simulation deck are kept together. Run `ngspice -b run.cir` from this directory with ngspice 46. The saved project also contains the same functional experiment for hosted execution.

Validation: zero native diagnostics; deterministic project-to-SPICE export matches `circuit.spice`; local and hosted specifications pass. See `verification.json`, `simulation.log` and `publication.json`.

Test-Impact: circuit assets only; functional SPICE experiments validate these drawings. No editor or model-library implementation changed. Nominal 27°C generic-model results are not foundry signoff.
