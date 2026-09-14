# VACASK analytical qualification

This divider is an analytical fixture, not a PDK model. Together with
[RC](../vacask-rc/rc.sim) and [resistor noise](../vacask-resistor-noise/noise.sim),
it establishes the native parser and numerical baseline before SKY130 work.

Run from the repository root after building `@icm/spice-run`:

```text
pnpm --filter @icm/spice-run build
node scripts/vacask-qualification.mjs --binary <vacask-executable> --modules <vacask-module-directory>
```

The script runs only these repository-owned circuits, uses fresh directories
and an explicit TOML startup configuration, and disables embed/postprocess.
It writes native inputs, output files, logs, hashes and measured errors under
ignored `output/vacask-qualification/run-*`. It returns failure if an expected
file/vector is absent, malformed, non-finite or outside its analytical tolerance.
This local runner is not the hosted executor and makes no sandbox guarantee.

Acceptance is defined before measuring:

- Divider OP: output 2 V, source current into its positive terminal -1 mA.
- DC: seven supply points from 0 to 3 V; output equals two-thirds of supply.
- Voltage tolerance: 1 nV absolute plus 1 ppm relative; source current:
  1 pA absolute plus 1 ppm relative.
- RC: complex `1/(1+j*2*pi*f*1ms)` over 10 Hz to 10 kHz, with 1e-9 absolute
  plus 1 ppm relative tolerance on each component. TRAN uses the exact response
  to the fixture's finite 1 us rise, not an instantaneous step approximation;
  tolerance is 0.2 mV absolute plus 100 ppm relative at actual solver timesteps.
- Noise: `4*k*300K*1kohm`, power spectral density in V^2/Hz, not V/sqrt(Hz).
  Tolerance is 1e-25 V^2/Hz absolute plus 10 ppm relative; gain is unity.

## Captured parser evidence

The `.raw` files beside these circuits are unedited simulator output captured
on 2026-09-14 using the official VACASK 0.3.4 Windows x86_64 package. They cover
OP, DC sweep, complex AC and noise; the larger transient stays in generated
run evidence. The parser tests read these files directly. No foundry circuit or
hosted Linux environment has been qualified by these tests.

Download: [official Windows package](https://fides.fe.uni-lj.si/vacask/download/vacask_0.3.4_windows-x86_64.zip).
Local download and extracted binaries live outside tracked code. Identities:

| Artifact | SHA-256 |
| --- | --- |
| Download archive | `f777e89c82944b2fff5a94e40eb8d0c4845889a065990e46f893741dde4167f7` |
| vacask.exe | `022e8491112e6af5041e4311a1cb9e9320b9a833faf5e9f27292ba739b5535c4` |
| resistor.osdi | `1f337573d20c5cb1d21084adc3f087072864082d0f1990e2c03a406100c7140e` |
| capacitor.osdi | `0fef2a99940483a5a098bbd2ad2055f8e1cb4bdf86add67d487b130945f50f52` |

VACASK and its supplied modules retain their upstream licenses. This repository
contains our small circuits and numerical outputs, not redistributed binaries.
The measured RC transient used 1566 native points, with maximum normalized
tolerance consumption 0.157; all nine analytical checks passed. Numerical
agreement on these fixtures is not a performance comparison or migration exit.

The [migration roadmap](../../docs/roadmap/vacask-migration.md) owns remaining
model, Linux runtime, application, GUI/MCP and cloud acceptance.
