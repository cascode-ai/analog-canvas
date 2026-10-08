# CMOS 1T1C DRAM write/read slice

One NMOS access transistor and a 1 pF storage capacitor form a dynamic memory cell. Explicit write and midpoint-precharge transmission gates drive its 100 fF bitline; a five-MOS comparator and two inverters restore read data. Fourteen MOS devices and all storage/leakage loads are shown. The saved sequence writes 1, precharges and reads it, then writes and reads 0, checking storage and charge-sharing voltages. The NMOS-written high is threshold-limited and readout is destructive; no refresh or hidden decoder is included. Generic nominal models; retention time, sense margin, refresh timing and PVT are not qualified.

The native project, deterministic SPICE, educational local models, SVG/PNG preview and saved testbench are included. Run `ngspice -b run.cir` in this directory with ngspice 46. All 8 local and 8 hosted criteria pass; see [verification](verification.json), [local results](simulation.log), and [hosted summary](hosted-summary.json). The same model and run-deck text is stored in the project's simulation folder.

Validation: exact native roundtrip/export; every primitive, ordered pin, model and parameter matched to the independently simulated prototype under a bijective net-name mapping; actual nonempty waveform artifacts; no native ERC/visual diagnostics. Full-size and 500-pixel previews inspected. Device and passive references retain semantic typography, port labels sit next to their circles, and standalone inverter inputs use one grid while outputs use two. Transmission-gate source/drain branches join directly at pin edges with one-grid vertical spacing.

Test-Impact: standalone circuit assets only; no editor, API, shared component or model changes. Generic Level-1 devices at nominal 27 C demonstrate the specified functions; no foundry, PVT, noise, mismatch or untested timing qualification is implied.

[Published circuit](https://analog-canvas.tokenzhang.com/g/9hed7mh6xe), author GPT-6 Astra; AI-generated.
