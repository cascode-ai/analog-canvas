# Native device output semantics probe

This repository-owned circuit uses the **default illustrative** NMOS/PMOS
parameters of VACASK's supplied `spice/bsim4v8.osdi` (`sp_bsim4v8`). It is not
SKY130, foundry data, a replacement PDK, or a hosted Profile qualification.
It tests whether native OP fields can safely be mapped to the product's
electrical quantities before implementing the remaining device helpers.

Run the existing local qualification tool, after building `@icm/spice-run`:

```text
node scripts/vacask-qualification.mjs --binary <vacask> --modules <module-directory> --device-outputs
```

The optional probe extends the existing report, fresh run directories, startup
control and digest recording. It does not create another product runner or
receipt system. Inputs, raw output and logs remain under the reported `output/`
directory, including when a numerical comparison fails.

## What is checked

- NMOS and PMOS at W=5 um, L=1 um, |Vgs|=1 V, |Vds|=1.8 V, Vbs=0;
  default module temperature/options, multiplicities 1 and 3.
- Physical drain current is obtained from its independent bias-source branch
  with passive sign convention; it scales by three.
- Model `id` and `gm` output variables are checked separately as per-instance
  values, not automatically treated as signed total terminal quantities.
- Actual gate/drain voltage signs and model-normalized output signs differ
  for PMOS. Native raw values are never rewritten to hide this distinction.
- 1 Hz AC transconductance is cross-checked against a centered DC perturbation
  of 10 uV at the same bias for each polarity.
- Whether the model's `gm` field matches that terminal derivative is a separate
  **mapping hypothesis**, not an assumption about all compact models.

Numeric comparison thresholds are explicit in the checker: 1e-12 in the
quantity's unit plus 1e-6 relative for ordinary scalar/multiplicity checks,
10 nS plus 1e-4 relative for finite-difference
derivatives, and 0.1 nS plus 1e-6 relative for AC multiplicity. These are diagnostic
mapping criteria, not newly widened SKY130 acceptance tolerances.

## Captured evidence (2026-09-14, Windows x86_64)

The four `.raw` files are unedited output from the official VACASK 0.3.4 package.
Binary SHA-256:
`022e8491112e6af5041e4311a1cb9e9320b9a833faf5e9f27292ba739b5535c4`.
`spice/bsim4v8.osdi` SHA-256:
`e5da8d9095f235f304a04ab4a2a6062cb20490401a6878559212f926964b4708`.
The similarly named `bsim4v8.osdi` is a different module; this evidence does not
apply to it. Binary download: [official package](https://fides.fe.uni-lj.si/vacask/download/vacask_0.3.4_windows-x86_64.zip).

23 of 25 checks pass. The two mismatches are retained, and the optional
qualification command exits nonzero:

| Device | Raw model gm (S) | DC terminal derivative (S) | AC terminal derivative (S) |
| --- | --- | --- | --- |
| NMOS | 0.000681806421332 | 0.001309348838790 | 0.001309350751915 |
| PMOS | 0.000307910890553 | 0.000572246226950 | 0.000572245207994 |

The agreement of AC with DC does **not** prove what the model's exported gm
means, and a mismatch with terminal gm does **not** establish a solver defect.
Investigate the module's intrinsic/output definition before adopting a mapping.
Raw `p(instance,gm)` may be exposed as an explicitly model-native field; do not
silently relabel or rescale it as total terminal transconductance. Likewise,
positive PMOS `id` is not the signed drain current. This finding constrains
those mappings, not unrelated simulation work or the entire migration.

Source references: [save and output syntax](https://codeberg.org/arpadbuermen/VACASK/src/commit/c1a1c84f1b2b9aa71c0cddf06e555441434db7b7/docs/cmd-save.md),
[multiplicity](https://codeberg.org/arpadbuermen/VACASK/src/commit/c1a1c84f1b2b9aa71c0cddf06e555441434db7b7/docs/cir-mfactor.md),
and [the SPICE-derived BSIM4 source](https://codeberg.org/arpadbuermen/VACASK/src/commit/c1a1c84f1b2b9aa71c0cddf06e555441434db7b7/devices/spice/bsim4v8.va).
Source inspection is supporting context; the package digests above identify the
actual measurements. Windows evidence is not Linux or Production acceptance.

## Isolated chain-rule correction (2026-09-15, Linux x86_64)

The supplied `spice/bsim4v8.va` drops three chain-rule terms when converting
`Ids * Vdseff` to the stored gm/gds/gmbs values: `tmp3` becomes zero and the
two other temporaries omit their Gm contribution. The source-end velocity
limiter also omits `Gm * T11`. The C BSIM4 implementation contains those
terms ([ngspice source](https://github.com/ngspice/ngspice/blob/master/src/spicelib/devices/bsim4/b4ld.c)).
This source link is supporting context, not the pinned ngspice 46 reference.
The supplied VA source and repaired output are hash-locked by the local tool.

Restoring these four terms in an isolated source copy passes all 25 existing
device checks. `chainrule-corrected/` contains the four unmodified raw outputs;
the original failing package outputs above are deliberately retained. Compiling
the **unmodified** supplied source reproduces the original mismatches and OTA
noise exactly, ruling out recompilation alone as the explanation.

Reproduce with the unpacked official package and the existing qualification tool:

```text
node scripts/vacask-bsim4-build.mjs --package <unpacked-package>
node scripts/vacask-qualification.mjs --binary <vacask> --modules <printed-candidate-modules> --device-outputs
```

The builder never edits the package or registers its output. Its fresh candidate
directory retains corrected source, compiler log and a `build.json` containing
input/output/compiler/module digests and compile arguments. Unknown source
revisions are refused; this is not a general model converter. Foundry model
parameters and numeric acceptance thresholds are unchanged.

Captured identities:

- VACASK binary: `bb606780f55d0b4f4b0e50503381d991cd2fd12298f85563bb4438b33c1abb13`.
- OpenVAF-reloaded binary: `6b1511f6663ce48f25955b06ffd5182528b82f5ecc9d94016098a4e557d95e47`.
- Original VA: `f1eecd715b90ab8a038c397a955beeb7ed4387b798791a2d9173122974034daa`.
- Corrected VA: `54c0e4a241831bac826f977627ceb62708c62a15a53e531abd17e5427e34a0e2`.
- Corrected module: `5c06ffb2aec8d96c2bbfdbde854e788ac704cbdf2f8d60ae90146aa22e3659a9`.

This does **not** establish parity with the existing SKY130 hosted Profile.
Its source selects BSIM4 4.5, whereas this VACASK module implements 4.8.3
despite accepting a `version="4.5"` model parameter. At 1 MHz the original
module's OTA output noise amplitude is about 40.8% below the frozen reference;
the corrected module is about 5.75% above it (and 18.58% above at 1 GHz).
Only a diagnostic ngspice run explicitly selecting **4.8.3** agrees with the
corrected candidate at the sampled 1 Hz/10 kHz/1 MHz/1 GHz points to within
2e-10 relative. That altered reference is version sensitivity evidence, not
a replacement baseline or permission to call the hosted model scope qualified.
The full migration must resolve model-version semantics before release.
