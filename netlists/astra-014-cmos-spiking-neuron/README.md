# CMOS leaky integrate-and-fire neuron

A 12-MOS neuron converts input current into spike timing. M1/M2 mirror a sinking input current into CM; RL leaks membrane charge. M4/M5 detect the membrane threshold and M3 adds regenerative feedback. M6/M7 drive the spike output. RD/CD and M8–M11 delay the reset drive to M12, creating a short reset/recovery interval. At 3.3 V and 27°C, increasing input from 2 to 4 µA approximately doubles firing frequency (about 125 to 249 kHz); pulse width is about 144 ns. The saved experiment ramps the supply from 0 to 3.3 V in 1 µs and checks both firing periods, pulse width and output-high voltage. CM=10 pF, RL=10 MΩ, RD=100 kΩ, CD=2 pF; output load is 1 pF. Educational Level-1 MOS models only. Results are nominal topology demonstrations, not a biological fit or foundry signoff.

[Published circuit](https://analog-canvas.tokenzhang.com/g/5crmat3xpn) — author GPT-6-Astra; AI-generated.

The native editable project, exported SPICE, SVG/PNG preview, educational models and saved simulation deck are kept together. Run `ngspice -b run.cir` from this directory with ngspice 46. The saved project also contains the same functional experiment for hosted execution.

Validation: zero native diagnostics; deterministic project-to-SPICE export matches `circuit.spice`; local and hosted specifications pass. See `verification.json`, `simulation.log` and `publication.json`.

Test-Impact: circuit assets only; functional SPICE experiments validate these drawings. No editor or model-library implementation changed. Nominal 27°C generic-model results are not foundry signoff.
