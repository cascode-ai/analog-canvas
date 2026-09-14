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
