# Native Agent/browser handoff fixture

This analytical voltage divider has no foundry model. `agent.sim` produces
OP `mid = 0.5 V`, source current `-0.5 mA`, and seven AC samples with transfer
`0.5 + j0`. The checked-in `.raw` files are unedited VACASK 0.3.4 Windows x86_64
output captured on 2026-09-15 with an explicit comment-only startup TOML.

- Simulator SHA-256: `022e8491112e6af5041e4311a1cb9e9320b9a833faf5e9f27292ba739b5535c4`.
- `resistor.osdi` SHA-256: `1f337573d20c5cb1d21084adc3f087072864082d0f1990e2c03a406100c7140e`.
- Package: [official VACASK release](https://fides.fe.uni-lj.si/vacask/download/vacask_0.3.4_windows-x86_64.zip).

`apps/editor/e2e/native-simulation-executor.mjs` replays these native records
through the shared native result assembler for `gui-native-simulation.spec.ts`
and refuses to replay them for a different source.
`apps/editor/e2e/agent-simulation.spec.ts` uses captured ngspice records
from `fixtures/ngspice-rawfile/`, not this fixture.

The GUI case runs `agent.sim` and opens its measurement's Console evidence. Its
simulation HTTP boundary is test-controlled. Hosted VACASK preview execution and
real-executable opt-in workflows are retired; this fixture remains only until
the follow-up VACASK engine removal.
