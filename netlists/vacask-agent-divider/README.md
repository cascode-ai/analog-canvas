# Native Agent/browser handoff fixture

This analytical voltage divider has no foundry model. `agent.sim` produces
OP `mid = 0.5 V`, source current `-0.5 mA`, and seven AC samples with transfer
`0.5 + j0`. The checked-in `.raw` files are unedited VACASK 0.3.4 Windows x86_64
output captured on 2026-09-15 with an explicit comment-only startup TOML.

- Simulator SHA-256: `022e8491112e6af5041e4311a1cb9e9320b9a833faf5e9f27292ba739b5535c4`.
- `resistor.osdi` SHA-256: `1f337573d20c5cb1d21084adc3f087072864082d0f1990e2c03a406100c7140e`.
- Package: [official VACASK release](https://fides.fe.uni-lj.si/vacask/download/vacask_0.3.4_windows-x86_64.zip).

`apps/editor/e2e/agent-simulation.spec.ts` uses these native records through the
real compiler and result assembler by default. It refuses to replay them for a
different source. It checks repair of a missing include, both session-workspace
and Project-folder ownership, idempotent Start, OP/AC arrays, CSV/SVG/PNG export,
autonomous Agent-to-GUI result handoff, saved-result reload and GUI rerun.
The AC numerical assertion is 12 decimal places against the analytical divider;
this is not a tolerance change for any model qualification fixture.

To execute actual VACASK instead of replaying captured records, build service
dependencies and run from the repository root:

```sh
pnpm --filter @icm/simulation-service... build
ICM_E2E_PORT=4392 ICM_E2E_ISOLATED=1 \
VITE_ICM_SIMULATION_UI=enabled VITE_ICM_SIMULATION_TRANSPORT=direct \
ICM_E2E_VACASK_REAL=1 VACASK_BIN=/absolute/vacask \
VACASK_MODULES=/absolute/modules \
pnpm test:e2e:local apps/editor/e2e/agent-simulation.spec.ts --workers=1
```

PowerShell users set the same variables with `$env:NAME = 'value'`. Optional
`ICM_VACASK_LIBRARY_PATH` supplies explicit Linux shared-library directories.
Real mode refuses missing executable/module settings; it never falls back to
captured records. Each scenario owns a temporary runtime root and waits for
process cleanup. No production endpoint is contacted or modified.
Each Playwright case attaches its result and execution mode to the test report;
real mode includes the measured runtime identity rather than the replay identity.

This is browser/Agent-resource parity evidence. The WebSocket peer and HTTP
boundary are test-controlled; neither mode proves the public MCP transport,
cross-Project DUT import, qualified SKY130 scope or cloud isolation. Those
remain separate exits in the [migration roadmap](../../docs/roadmap/vacask-migration.md).

## Real MCP transport journey

`apps/editor/e2e/mcp-native-simulation.spec.ts` is a separate opt-in test. With
the same real-runtime variables above, first build `@icm/mcp-server...`, then
run that spec. It starts the actual MCP stdio entry point and uses the browser's
real local Worker/Agent Durable Object: no intercepted Agent messages, fake
claims or direct service invocation stand in for the MCP transport. The
simulation HTTP boundary still belongs to the test and forwards prepared input
to the real native runtime; it is not an operator-host or cloud gateway test.

The case covers helper discovery, session-workspace authoring, missing-include
repair, Prepare/Start/Read, repeated Start with the same identity, verified CSV
download and restarting MCP to resume the approved connector and read the same
run without another execution. Its connector and exports stay in an owned
temporary directory. The opt-in flag is required; a normal browser suite skips
this test rather than silently substituting a mocked relay or captured solver.

Use Playwright's JSON/HTML reporter to retain the `public-mcp-native-run`
attachment containing the measured result identity. For JSON, set
`PLAYWRIGHT_JSON_OUTPUT_FILE` to an ignored working path and pass
`--reporter=line,json`. This proves local public-MCP protocol integration, not
hosted authentication/isolation, cross-Project DUT import, or model qualification.
