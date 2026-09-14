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
bin labels versus declaration ordinals, local bin scope, scaled per-finger
geometry, ordinary `rbody` resistors, `tref`/`rgeomod` names, subcircuit `m`
forwarding and library-owned primitive masters. Parameter-name mappings and
bin geometry follow the pinned simulator's `lib/netlistrs.cpp` behavior.

The directory named `continuous` still contains binned models. Its name is not
a promise that every W/L/NF is supported. The seven baseline wrappers remain
the acceptance target; other included wrappers are not qualified.

On Linux VACASK 0.3.4, all seven wrappers solve at TT/FF/SS/FS/SF. The 50 probe
values matched a same-kernel diagnostic run reading the original model syntax.
That diagnostic path is not a product fallback. Against the frozen hosted
ngspice 46 references, MOS discrepancies remain, up to about 1.12% at these
points. The original absolute tolerances are retained and **do not pass**.
The model trees are not proven identical, so these differences are not
attributed solely to solver error.

The source declares BSIM4 4.5/4.62; the installed `sp_bsim4v8` module warns
that it executes 4.8.3. This warning is preserved. Geometry/bias/multiplicity
sweeps, OTA OP/AC/TRAN/Noise and model/environment equivalence remain open.
Neither conversion success nor these point probes qualifies deployment.

Offline conversion integration tests use `ICM_VACASK_CONVERTER_SOURCE` and
`ICM_SKY130_MODEL_SOURCE` (defaulting to the local `plan/upstream` checkouts).
They skip when those optional dependencies are unavailable; CI does not
silently download models. The pure probe-comparison tests always run.
