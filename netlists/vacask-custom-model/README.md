# User-authored Verilog-A qualification

[icm_conductance.va](icm_conductance.va) is an illustrative two-terminal device
with electrical inout ports `p`, `n` and conductance parameter `g` in siemens.
It contributes `I(p,n) = g*V(p,n)` continuously. It has no hidden state, timing
events, PDK claims or foundry parameter substitutions.

[custom.sim](custom.sim) applies 2.5 V to `g=2m` and expects the voltage source's
current into its positive terminal to be -5 mA. Acceptance is 1 pA absolute plus
1 ppm relative on current and 1 nV plus 1 ppm on voltage.

Extend the [analytical qualification run](../vacask-divider/README.md) with
`--compiler <openvaf-r-executable>`. This compiles the source in a fresh output
directory using `--target_cpu generic`, records compiler/source/module digests,
loads the generated OSDI into VACASK, and checks the actual circuit results.
The report explicitly says when this optional case was not requested.

The compiler and simulator must use compatible OSDI ABIs. Compilation also
requires a host linker: Windows OpenVAF requires the MSVC linker. A missing
linker in the tested Windows compiler printed errors but returned exit code 0;
the qualification therefore checks for the new output artifact and verifies
successful runtime loading and numbers, not process exit alone.

This tests controlled local compilation, not arbitrary user uploads or a cloud
compiler service. It does not establish the scope of a foundry model library.

## Measured Linux evidence

On 2026-09-14, the official [Linux x86_64 package](https://fides.fe.uni-lj.si/vacask/download/vacask_0.3.4_linux-x86_64.tar.gz)
passed all nine analytical checks and both custom-model checks under Ubuntu
24.04 WSL. The captured [custom_op.raw](custom_op.raw) is unedited native output:
2.5 V and -5 mA, with zero error for the two custom-model observables.

| Artifact | SHA-256 |
| --- | --- |
| Linux archive | `780949fc75181d5839cc8c8091e05c2ca2e70a73c9f920e88553228061c44027` |
| VACASK 0.3.4 | `bb606780f55d0b4f4b0e50503381d991cd2fd12298f85563bb4438b33c1abb13` |
| OpenVAF-Reloaded | `6b1511f6663ce48f25955b06ffd5182528b82f5ecc9d94016098a4e557d95e47` |
| Compiled conductance OSDI | `35d5f9259ce83d5d34d5c0a17b3017aed4415f9e6582f58d50dc9c6e9eb1e283` |

The compiler reports `osdi_0.5_20260820-7-gde9c640b`. Linux modules are in
`lib/vacask/mod`, unlike the Windows package's `lib/mod`. Compilation used
the system linker and generic target CPU. The OSDI hash records this build,
not a promise that every toolchain produces identical binary bytes.

The run additionally required Ubuntu KLU/SuiteSparse 7.6.1, OpenBLAS 0.3.26
pthread, and GNU Fortran runtime dependencies, extracted into a local directory
and selected with `LD_LIBRARY_PATH`. This is local evidence, not a reproducible
hosted image; fixing the complete linked runtime belongs to the migration Profile.
No deployment, foundry-model qualification or user-upload service is claimed.
