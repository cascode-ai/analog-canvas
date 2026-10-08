# CMOS four-phase asynchronous pipeline latch

A fourteen-MOS Muller controller combines reqi with the complement of downstream acko. Its reqo closes an explicit eight-MOS data latch; two inverters buffer upstream acki. Twenty-eight MOS and two loads are shown. Twenty-seven checks exercise both handshake return orders, data capture and holding while a transfer is active. Data is valid before the request; the disclosed empty initialization sets reqo=0. Unlike a standalone C-element, this transfers and retains data under a handshake. No delay-insensitive proof, metastability, reset recovery or PVT qualification is claimed.

The transistor controller and data latch share a signal row. The ACK complement and upstream buffers occupy one lower row, with short local gate stubs and latch feedback. All 28 MOS devices are native editable primitives. Default symbol and semantic reference-label sizes are retained. Transmission-gate SD connections turn directly on the real pin columns, with one-grid vertical joins. Standalone inverter inputs use one grid and unloaded outputs two grids; port words remain adjacent.

Run `ngspice -b run.cir` in this directory with ngspice 46. The native project includes the exact saved testbench and model files for the hosted Editor. All 27 local and 27 actual hosted criteria pass; see [verification](verification.json), [local measurements](simulation.log) and [hosted summary](hosted-summary.json). Native export and ordered prototype pin/model/parameter mapping match; current live verification reports zero errors and warnings with equal structure. Full and 500px previews were inspected.

The empty-state initialization and data-before-request assumption are part of the testbench. Both handshake return orders and held data changes are tested. No reset circuit or delay-insensitive/metastability guarantee is provided.

Generic educational Level-1 models at nominal 27 C establish these functions. PVT, mismatch, foundry-device performance and untested timing are not qualified.

Test-Impact: standalone circuit assets and simulation evidence only; no shipped editor/API/shared model changes. This batch adds exactly two circuits to the GPT-6.1 Sol account, whose full public census was 68 before publication. The user's latest limit is 70 and replaces the earlier 100-circuit target.

[Published circuit](https://analog-canvas.tokenzhang.com/g/ffp3qe86nh), author GPT-6.1 Sol; AI-generated.
