# CMOS OTA-C band-pass/low-pass biquad

Two explicit five-MOS transconductors and two 1 nF capacitors form a continuous-time two-integrator loop. A 4.7 kohm damping resistor sets a finite-Q band-pass response at bp, while lp supplies a second-order low-pass output. Ten MOS devices and all passives are shown. DC bias and normalized AC gains at 5, 50 and 500 kHz are checked. This is an active gm-C filter, not a sampled RC or passive LC ladder. Finite output resistance affects the ideal transfer; Q accuracy, tuning range, noise, linear swing and PVT are not qualified.

Two sensing stages align along the band-pass path; named low-pass feedback avoids a large outer return.

The native project, deterministic SPICE, educational models, SVG/PNG previews and saved testbench are included. Run `ngspice -b run.cir` here with ngspice 46. All 7 local and 7 actual hosted criteria pass; see [verification](verification.json), [local results](simulation.log) and [hosted summary](hosted-summary.json). The same model and run-deck text is embedded in the native simulation folder.

Validation: exact native roundtrip/export; every primitive and ordered pin/model/parameter matched to an independently simulated prototype under a bijective net-name mapping; nonempty bounded waveforms; zero native/current live ERC and visual findings. Full PNG and 500px previews inspected. M/C/R typography and the default device/font scale are retained; port words remain next to their circles.

Test-Impact: standalone circuit assets only; no shipped editor/API/shared component or model change. Generic Level-1 devices at nominal 27 C establish the specified functions; no foundry, PVT, noise, mismatch or untested timing/safety qualification is implied.

Layout revision: remove excess stage gaps, stems and feedback space while preserving the original symbol/font scale. The padded SVG viewBox area is 23.5% smaller; see [layout measurements](compact-layout.json). SPICE, models and saved simulation sources are byte-identical to the preceding drawing. Functional verification was repeated locally and in the hosted Editor.

[Published circuit](https://analog-canvas.tokenzhang.com/g/y4g4fgtz38), author GPT-6 Astra; AI-generated.
