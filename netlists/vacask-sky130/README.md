# Native SKY130 model candidate

This is **not a qualified replacement Profile**. It is an offline conversion
recipe and a seven-device OP/AC probe, using original model files without
editing foundry parameter values. The product executor is not switched.

## Reproduce

Use Python 3.10+, Git, the built `@icm/spice-run` package, and clean checkouts:

- [VACASK](https://codeberg.org/arpadbuermen/VACASK) at
  `c1a1c84f1b2b9aa71c0cddf06e555441434db7b7`.
- [SKY130 models](https://github.com/fossi-foundation/skywater-pdk-libs-sky130_fd_pr)
  at `403964dc7f9cca5ec1a8cc7b4f2a6f532b781676`.

The converter refuses other revisions or modified source files. It uses the
upstream parser plus owned lowering corrections; it does not require a patched
upstream checkout. Run from the repository root:

```text
python scripts/vacask-sky130-convert.py --upstream <VACASK-checkout> --models <SKY130-checkout> --output output/vacask-models
```

Every attempt creates a fresh `candidate-*` directory. `conversion.json`
records the recipe digest, exact input file digests, native file digests and
required OSDI module paths for all five corners. Native files use LF on every
platform. Original model copyright/license headers remain in those files.
Generated models are not checked into this repository.

Run the existing qualification harness with the printed candidate directory:

```text
pnpm --filter @icm/spice-run build
node scripts/vacask-qualification.mjs --binary <vacask> --modules <matching-module-directory> --sky130-models <candidate-directory>
```

Use matching simulator/module binaries for the target platform. The harness
uses controlled startup, bounded processes, fresh per-case directories and
copies each model beside the [device probe](devices.sim) that includes it.
It retains stdout/stderr, raw files, hashes, actual probe values and every
comparison. It validates the native file against the conversion digest before
execution. A failed comparison exits nonzero, without weakening thresholds.
The AC probe uses `values=[1e9]`: native linear `points=1` means one interval,
not one sample.

## What was repaired and what remains

The offline upstream converter needed corrections for integral float model
levels, relative include ownership, quoted/whitespace-containing expressions,
bin labels versus declaration ordinals, local bin scope, source bin-boundary
selection, ordinary `rbody` resistors, `tref`/`rgeomod` names, subcircuit `m`
forwarding and library-owned primitive masters. Parameter-name mappings and
parameter lowering follow the pinned simulator's native device interfaces.

Bin selection preserves the source Profile's ngspice 46 semantics: reverse
declaration priority, a strict `< 1e-9 m` tolerance at either edge, and total
W unless an explicit instance `wnflag` requests W/NF. W and NF passed into the
compact model are unchanged. See the fixed reference's
[range/width rules](https://sourceforge.net/p/ngspice/ngspice/ci/ebdaf58ec76a06ffaac7e0f138360dd1cf5ee4b6/tree/src/spicelib/parser/inpgmod.c)
and [model insertion order](https://sourceforge.net/p/ngspice/ngspice/ci/ebdaf58ec76a06ffaac7e0f138360dd1cf5ee4b6/tree/src/spicelib/parser/inpmkmod.c).
The recipe records this policy and its helper digest. It does not adopt the
native foreign parser's different bin rules or add an executable fallback.

Source parameter division is lowered with a real unit multiplier before `/`:
`361*nf/w+1489` becomes `361*nf*1.0/w+1489`. For integer-authored NF=2, W=3,
this preserves 1729.666... instead of native integer truncation to 1729.
Nesting and left-to-right multiplication/division order are retained; string
values are untouched. This is a source-model conversion rule, not a rewrite
of authored native VACASK programs. Its helper digest is also recorded.

The directory named `continuous` still contains binned models. Its name is not
a promise that every W/L/NF is supported. The seven baseline wrappers remain
the acceptance target; other included wrappers are not qualified.

On Linux VACASK 0.3.4, all seven wrappers solve at TT/FF/SS/FS/SF. An earlier
conversion matched all 50 same-kernel foreign-parser values yet differed from
the hosted reference by up to 1.12%. That comparison shared the wrong source
bin selection and was not sufficient conversion evidence.

The frozen hosted binary has now reproduced the TT/FF reference locally. Its
four MOS model bodies and all five FET corner parameter files match this
source after comment/whitespace normalization. At L=0.5 um the original
ngspice selects nshort_model.6; the old lowering selected .5. Corrected bin
selection removes the large FF/SS differences. The remaining LVT PFET error
was traced to integer division of its sheet-resistance expression. With both
corrections and explicit reltol=1e-8, abstol=1e-15, vntol=1e-10, all 50 point
comparisons pass the unchanged original thresholds. These solver settings are
now in the device probe, not silently applied to every product run. With native
default solver tolerances, ten NFET current comparisons still exceed the strict
reference tolerances (maximum relative error about 0.00342%).

Passing these OP/AC device points does not qualify the full Profile: bias,
geometry, temperature and multiplicity sweeps, OTA DC/AC/TRAN/Noise and the
hosted environment still require their own evidence. These historical point
comparisons did not change model coefficients or acceptance thresholds.

The product owner has approved an explicit upgrade from the source's BSIM4
4.5/4.62 declarations to 4.8.3, subject to requalification. The converter now
emits `version="4.8.3"` and records the source-version counts in each corner's
conversion evidence. It does not alter the pinned foundry files or imply that
old results are unchanged. The native module must also include the proven
[chain-rule correction](../vacask-device-outputs/README.md).

Geometry/bias/multiplicity sweeps and OTA OP/AC/TRAN/Noise require an independent
same-version reference. The older ngspice 46/BSIM4 4.5 baseline is preserved for
historical differences, not relabelled as 4.8.3. Neither conversion success nor
the seven-device OP/AC point probes qualifies deployment.

Acquire independent five-corner OTA OP/DC/AC/TRAN/Noise reference files with:

```text
node scripts/vacask-sky130-reference.mjs --binary <frozen-ngspice-46> --models <original-opt-sky130-directory>
```

This offline tool verifies the original binary and complete `/opt/sky130` tree
against the historical Profile before copying its `continuous` directory. It
changes only BSIM equation-version declarations in that copy, records per-file
source/upgraded hashes and counts, then runs the existing OTA circuit and source
values at all five corners. The reference uses explicit reltol=1e-8,
abstol=1e-12, vntol=1e-10 and a 2 ns transient maximum step. Each fresh evidence
directory retains decks, raw files, stdout/stderr and `reference.json`; neither
the original models nor the old reference JSON is changed. Successful reference
acquisition does not itself mean VACASK has passed a comparison. It is not a
product runner, a runtime fallback, or a cloud model installation tool.

For sampling convergence, add `--noise-points 200` (points per decade; default
20), or `--noise-details` to capture each source contribution as well as the
total spectrum and integrals. The selected settings are recorded in
`reference.json`. Other analyses, source values, models and solver settings do
not change. Runs retain the existing timeout; a very dense capture may fail
rather than silently returning fewer points.

### Noise integration is a separate numerical contract

At TT with the upgraded BSIM4 4.8.3 reference, all 181 input/output noise ASD
samples agree with the corrected native model within relative 1e-8 plus
absolute 1e-15. This does **not** mean the two engines' integral labels denote
the same algorithm. The product explicitly integrates the recorded total PSD
by the trapezoidal rule and refers each frequency through its own power gain.
It labels these values `trapezoidal-psd`, including in CSV and output semantics.

The following independent ngspice 46 measurements hold all other inputs fixed
(1 Hz–1 GHz; values in V RMS):

| Points/decade | Reported output | Total-PSD trapezoidal output | Reported input | Total-PSD trapezoidal input |
| ------------- | --------------- | ---------------------------- | -------------- | --------------------------- |
| 20            | 0.002520668164  | 0.002523919919               | 0.000784694629 | 0.000755139535              |
| 200           | 0.002521052765  | 0.002521085282               | 0.000757983909 | 0.000755058836              |
| 2000          | 0.002521056615  | 0.002521056938               | 0.000755350238 | 0.000755058025              |

The current product's 20-point integrals are 0.002523919919 and 0.000755139535:
they match the **same method applied to the reference spectrum**, not the
reported ngspice totals. Summing the 84 captured BSIM noise-source integrals
with a power-law fit and the interval's right-end gain reproduces the reported
input value to relative 2e-13. Thus changing the native model to match that
scalar would be incorrect. The upstream [noise integrator](https://github.com/ngspice/ngspice/blob/master/src/spicelib/analysis/ninteg.c)
and [BSIM noise source integration](https://github.com/ngspice/ngspice/blob/master/src/spicelib/devices/bsim4/b4noi.c)
explain the mechanism; these moving source links are explanatory, not the
identity of our independently hashed ngspice 46 binary.

Qualification must compare spectra and like-for-like integrals, retain the
simulator-reported totals separately, and assess sampling convergence. This
finding neither relaxes the spectrum tolerance nor qualifies the remaining
AC, TRAN, full model domain or hosted Profile. Product integration behavior
was not changed to chase the reference totals.

### OTA time-discretization investigation (not full acceptance)

With the same upgraded model tree and corrected native module, tighter
Newton tolerances alone do not remove the small AC residual. At reltol=1e-10,
vntol=1e-12 and a 1 fA current floor for OP/AC, the worst Vout real-component
difference is 3.075e-8 at approximately 50.1 kHz (gain approximately 117.61),
or about 2.6e-10 relative. This remains outside the historical 1e-8 absolute
check and is recorded as unresolved, not silently accepted as roundoff.

For TRAN, both engines used the original 1 ns-rise pulse, reltol=1e-10,
vntol=1e-12 and a 1 pA current floor. Reducing the maximum step demonstrates
that the large Vout discrepancy is time-discretization dependent:

| Maximum step in both engines | Comparison coverage                              | Worst interpolated Vout difference |
| ---------------------------- | ------------------------------------------------ | ---------------------------------- |
| 0.2 ns                       | Original 0–4 us run                              | 50.25 uV                           |
| 0.02 ns                      | Original 0–4 us run                              | 0.4992 uV                          |
| 0.002 ns                     | Original circuit, recorded 1–1.05 us edge window | 0.009208 uV                        |

The 0.2-to-0.02 ns change shows approximately second-order convergence. The
last row is deliberately a **short-window diagnostic**, not a claim that the
complete waveform or all nets pass. The edge-window tail, mirror and bias
node differences still exceed 1e-8 V (approximately 0.235 uV, 0.168 uV and
0.0105 uV respectively), concentrated at pulse corners. Comparisons interpolate
only within recorded reference coverage; neither simulator's raw axis or
values are rewritten. Default sampling and the original historical baseline
remain unchanged.

To reproduce the convergence experiment, use the captured public compiled
OTA circuit and its independent reference circuit, select Vout, bias, tail
and mirror-node voltages, and run OP/AC with the stated 1 fA floor. Before
TRAN change only the floor to 1 pA, then vary the maximum step in both engines.
For the short window, keep the pulse delay at 1 us, retain the initial OP,
integrate from zero, record from 1 us and stop at 1.05 us. Do not use UIC or
shift the pulse to simulate an isolated edge with a different initial state.

These are offline numerical investigations, not proposed product defaults.
At 0.02 ns the native full run contains 202,413 samples and its four-voltage
raw artifact is about 24.6 MB, above the public journey's 8 MiB output budget.
A 0.1 pA floor instead of 1 pA causes the native transient to abort, both with
and without inserted current-sense sources; the process still exits zero but
produces no transient raw file. Artifact presence and declared analysis
completion remain mandatory. Neither a missing waveform nor tighter settings
that fail to converge count as qualification. Full model-domain/observable
acceptance and efficient public-runtime sampling remain open.

Offline conversion integration tests use `ICM_VACASK_CONVERTER_SOURCE` and
`ICM_SKY130_MODEL_SOURCE` (defaulting to the local `plan/upstream` checkouts).
They skip when those optional dependencies are unavailable; CI does not
silently download models. The pure probe-comparison tests always run.
