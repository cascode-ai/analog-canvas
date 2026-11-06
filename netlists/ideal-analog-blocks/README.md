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
vendor models. VDD/VSS preserve the interface and draw no quiescent current; the
single-ended Op Amp limits its output to `vhigh`/`vlow` (VDD/VSS by default).
Single-ended outputs are referenced to node 0; FD outputs are symmetric about
`vocm` (0 by default). There are no process/temperature corners.

Generated decks and data go to a reported temporary directory, not the
repository. CI does not run this command.
