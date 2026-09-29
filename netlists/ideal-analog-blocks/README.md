# Ideal analog block acceptance

Build the workspace, then run:

```powershell
node netlists/ideal-analog-blocks/verify.mjs /path/to/ngspice
```

The command generates Projects and exports through the shipped circuit-source
path before running real ngspice. It checks Op Amp and its Wide variant, V Amp,
gm, Diff gm, FD Amp and FD Amp Wide. Two overrides give effective voltage gains
of 2 and 7 (gm uses a 1 kohm load). Supplies bind explicitly to AVDD/AVSS;
no Global is synthesized. Missing simulator output fails acceptance.

- OP: 0.1 V input, output gain and both FD output polarities.
- DC: -0.1 to +0.1 V in 0.05 V steps.
- AC: complex gain at 25 frequencies from 1 Hz to 1 MHz.
- TRAN: 0/0.1 V pulse, 10 ns nominal step, 5 us duration; every sample checked.
- Absolute tolerance: 1e-8 V (or V/V for AC).

These are frequency-independent E/G-source **ideal models**, not transistor or
vendor models. VDD/VSS preserve the interface but do not add clipping,
quiescent current or common-mode control. Outputs remain referenced to node 0;
FD outputs are symmetric about 0. There are no process/temperature corners.
No Symbol geometry or pin ordering changes.

Generated decks and data go to a reported temporary directory, not the repository.

Validated with native ngspice 46 on Windows on 2026-09-29: all 56
device/parameter/analysis combinations passed. This is local simulator evidence,
not an assertion that CI installs ngspice or that vendor models were qualified.
