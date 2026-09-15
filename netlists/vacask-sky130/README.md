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
hosted environment still require their own evidence. Source-version warnings
remain visible, and no model coefficients or acceptance thresholds were changed.

The source declares BSIM4 4.5/4.62; the installed `sp_bsim4v8` module warns
that it executes 4.8.3. This warning is preserved. Geometry/bias/multiplicity
sweeps, OTA OP/AC/TRAN/Noise and model/environment equivalence remain open.
Neither conversion success nor these point probes qualifies deployment.

Offline conversion integration tests use `ICM_VACASK_CONVERTER_SOURCE` and
`ICM_SKY130_MODEL_SOURCE` (defaulting to the local `plan/upstream` checkouts).
They skip when those optional dependencies are unavailable; CI does not
silently download models. The pure probe-comparison tests always run.
