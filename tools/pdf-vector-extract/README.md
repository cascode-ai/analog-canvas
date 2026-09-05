# PDF vector extraction

This directory contains source-PDF extraction tools. It is deliberately
separate from `tools/calibration/razavi/fidelity-diff.mjs` and `scripts/lib/`, which own
the raster comparison workflow.

The family extractors currently cover:

- `extract-razavi-inductor.py`: continuous inductor path from Figure 15.21;
- `extract-razavi-magnetic-components.py`: native-vector layout, topology, and
  polarity-dot evidence for the OJSSCS Figure 19(a) transformer and the
  _Bridged T-Coil_ Figure 2 network. Product generation reuses the reviewed
  Inductor and Capacitor artwork instead of copying either paper's passive
  curves;
- `extract-razavi-opamp.py`: triangle, three leads, and polarity marks from
  Figure 8.26;
- `extract-razavi-differential-opamp.py`: direct four-terminal amplifier body,
  dual-output edge joins, and polarity marks from Figure 13.48;
- `extract-razavi-common-assets.py`: NPN/PNP BJT, diode, voltage amplifier,
  and ideal switch.
- `extract-razavi-zener.py`: direct Zener diode geometry from Figure 3.44(a)
  of _Fundamentals of Microelectronics_;
- `extract-razavi-logic-gates.py`: inverter, AND, NAND, NOR, and XOR native
  vectors from Figures 16.2, 16.24, and 16.25. OR and XNOR are explicitly
  derived by the family generator from these direct sources.
- `extract-razavi-buffer-dff.py`: direct Buffer geometry from Figure 16.53(a)
  and the generic D/CK/Q/Q-bar flip-flop block from Figure 16.23(a).
- `extract-razavi-digital-simulation.py`: square clock-pulse treatment from
  Figure 16.8 and stacked timing-waveform treatment from Figure 20.54 of
  _Analysis and Design of Data Converters_. These are scoped visual references,
  not executable simulation semantics.

Each extractor writes:

- a normalized, provenance-bearing vector evidence JSON; and
- a small PDF-rendered PNG witness used by the existing raster diff harness.

The source PDF is not copied into the repository. Its SHA-256, PDF page,
printed page, figure, and selected path fingerprint are recorded in the JSON.
The authority manifest separately pins both generated files.

Example (PowerShell):

```powershell
$python = (Get-Command python).Source
& $python tools/pdf-vector-extract/extract-razavi-inductor.py `
  --pdf "$env:ICM_REFERENCE_ROOT\books\razavi-design-of-analog-cmos-integrated-circuits-2e.pdf" `
  --output-json fixtures/visual-reference/razavi-reference-v1/inductor-vector-source.json `
  --output-png fixtures/visual-reference/razavi-reference-v1/inductor-reference.png
```

The extractor depends on `pdfplumber`, Pillow, and Poppler's `pdftoppm`. It
does not import or modify the raster fidelity implementation.

The common extractor accepts `--asset all` (default) or one symbol ID. It
records `selection.method` and `derivation` whenever electrical pin extensions
or other semantic normalization are added, so they cannot be mistaken for
native PDF artwork.

The magnetic-component extractor accepts the two external PDFs independently.
It records native object fingerprints and emits one tight source crop per
component. The extract's normalized product layout is the only bridge to the
family generator; source paths, local machine paths, and PDF files never enter
the runtime catalog.
