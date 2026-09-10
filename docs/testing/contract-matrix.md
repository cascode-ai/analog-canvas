# Test Contract Matrix

This matrix assigns a primary test boundary to current product behavior. It is
an index for change impact, not a claim that the listed suites are exhaustive.

| Contract                                                         | Primary owner and checks                                                                                           | Higher-level confirmation                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Persisted Project schema, migration, and compatibility rejection | `packages/model/src/schema.test.ts` and `packages/project-protocol/src/{persistence,compatibility-corpus}.test.ts` | project-file and recovery editor tests                          |
| Persisted coordinate domain and grid normalization               | `packages/model/src/coordinate-domain.test.ts`                                                                     | Editor snap and drafting manipulation tests                     |
| Typed edit atomicity, history, and routing constraints           | `packages/edit-engine/src/{transaction,history,routing,wire-editing}.test.ts`                                      | Editor wiring and movement workflows                            |
| Electrical topology identity                                     | `packages/agent-adapter/src/snapshot.test.ts` with `@icm/derived` hash implementation                              | Agent snapshot/session behavior                                 |
| Connectivity, diagnostics, and hierarchy interpretation          | `packages/derived/src/{derived,current-contract,diagnostics/*.test.ts}`                                            | Editor net highlighting and Agent snapshots                     |
| Formal SVG and export artifacts                                  | `packages/render-svg/src/*.test.ts`, `packages/exporters/src/exporters.test.ts`                                    | visual golden and release checks                                |
| Design-netlist extraction and printing                           | `packages/netlist/src/{current-contract,printers}.test.ts`                                                         | editor netlist authoring workflow                               |
| Analog Simulation deck compilation and source/probe mapping      | `packages/netlist/src/{simulation-compile,source-waveform}.test.ts`                                                | existing Agent Simulation browser workflow                      |
| Analog Simulation execution, lifecycle, and artifact contracts   | `packages/simulation-service/src/*.test.ts`                                                                        | existing Agent/MCP and browser wiring checks                    |
| ngspice process, environment, rawfile, and result interpretation | `packages/spice-run/src/*.test.ts`                                                                                 | qualified fixture and Preview smoke checks                      |
| Digital Timing Simulation logic and waveform projection          | `packages/timing-simulation/src/*.test.ts` and focused Editor timing tests                                         | development-only timing window workflow                         |
| Agent authentication, permissions, and session lifetime          | `packages/agent-adapter/src/{session-state,service,request-contract}.test.ts`                                      | browser Agent session workflow                                  |
| Browser recovery and persistence hardening                       | editor document unit contracts                                                                                     | recovery dialog and hardening Playwright specs                  |
| User-visible editing workflows                                   | focused editor unit contracts                                                                                      | `apps/editor/e2e/` scenarios                                    |
| Validation policy and change-impact selection                    | `scripts/lib/{validation-gates,ci-validation-plan,test-impact}.test.mjs`                                           | focused required browser checks with conservative full fallback |

When a change touches more than one row, add or update a cross-module test only
for the shared fact. Do not duplicate all lower-level cases in Playwright.

## Simulation vocabulary

`Timing Simulation` means the deterministic digital timing engine in
`packages/timing-simulation`. `Analog Simulation` means the structured Canvas
to ngspice path owned by `packages/netlist`, `packages/simulation-service`, and
`packages/spice-run`. Tests and documentation must use those names instead of
the unqualified word "simulation" when the distinction matters.

Recorded ngspice rawfiles are parser and numerical-reference fixtures. Package
builders are unit or module-contract fixtures. A browser Project is a workflow
fixture. Reusing one authoritative, human-importable Project across layers is
allowed, but each layer asserts only the contract it owns. This matrix does not
add or freeze a new full-chain Project; that fixture and its acceptance scope
remain a separate product decision.
