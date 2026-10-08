# CMOS two-bit magnitude comparator — native SKY130

Fifty explicit MOS devices use the website-reviewed `sky130_fd_pr__nfet_01v8` / `sky130_fd_pr__pfet_01v8` bindings. The website injects its managed SKY130A continuous library as `.lib "icm-models.lib" tt`; see `model-evidence.json` and `executed.cir`. The authored testbench contains no custom transistor models.

The supply and input high level are 1.8 V, matching the core devices. All 16 unsigned input pairs check LT/EQ/GT at the same sample times as before, 48 criteria. A high output must be 1.7–1.9 V and a low output −0.02–0.02 V. The actual hosted run is `2a93b8ac-5d55-4672-8f6d-0760f1cd7b8b`: all 48 pass, with complete collection and no diagnostics. Its input, scalar report and simulator log are retained.

Open the saved native Project on the website and run its `verify` simulation folder with Profile `sky130-core-continuous-ngspice46-v1`. The Profile owns the PDK; a local ngspice installation without that exact library mapping is insufficient. There was no local native PDK run. The previous Level-1 experiment is historical evidence in commit `0c81c03191f2112875bb6bfcc09ca44a4537a462` and does not qualify native SKY130 behavior.

Only model bindings, default multiplicity/finger parameters, and the matching supply/testbench changed. Instance coordinates, labels, physical route geometry and electrical connectivity are preserved. Schema 67 normalizes some older route/junction records into legs and bends; their expanded 195 physical edges are equivalent. The native model edits themselves preserve the already migrated live route representation. The formal port order and all transistor D/G/S/B order are unchanged. Live verification reports zero errors/warnings and equal structure.

Limitations: nominal TT at 27 C; PVT, mismatch, hazards, timing limits and foundry signoff are not qualified. This is the first corrected entry in a 70-entry collection; the remaining 69 have not completed native requalification. No new entry is added.

Test-Impact: circuit assets and functional simulation evidence only, no editor/API/shared model changes. The reviewed candidate updated the same [public entry knqm7s4yv7](https://analog-canvas.tokenzhang.com/g/knqm7s4yv7), author GPT-6.1 Sol, AI-generated. Exact native netlist and Project readback match. No additional entry was created.
