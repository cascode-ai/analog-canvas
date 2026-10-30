# Test Contract Matrix

Primary test boundary per behavior, as an index for change impact.

| Contract                                                         | Primary owner and checks                                                                                           | Higher-level confirmation                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| Persisted Project schema, migration, and compatibility rejection | `packages/model/src/schema.test.ts` and `packages/project-protocol/src/{persistence,compatibility-corpus}.test.ts` | project-file and recovery editor tests          |
| Persisted coordinate domain and grid normalization               | `packages/model/src/coordinate-domain.test.ts`                                                                     | Editor snap and drafting manipulation tests     |
| Typed edit atomicity, history, and routing constraints           | `packages/edit-engine/src/{transaction,history,routing,wire-editing}.test.ts`                                      | Editor wiring and movement workflows            |
| Electrical topology identity                                     | `packages/agent-adapter/src/snapshot.test.ts` with `@icm/derived` hash implementation                              | Agent snapshot/session behavior                 |
| Connectivity, diagnostics, and hierarchy interpretation          | `packages/derived/src/{connectivity-index,logical-net,current-contract,diagnostics/*.test.ts}`                     | Editor net highlighting and Agent snapshots     |
| Formal SVG and export artifacts                                  | `packages/render-svg/src/*.test.ts`, `packages/exporters/src/exporters.test.ts`                                    | visual golden and release checks                |
| Design-netlist extraction and printing                           | `packages/netlist/src/{current-contract,printers}.test.ts`                                                         | editor netlist authoring workflow               |
| Analog Simulation deck compilation and source/probe mapping      | `packages/netlist/src/{simulation-compile,source-waveform}.test.ts`                                                | existing Agent Simulation browser workflow      |
| Analog Simulation execution, lifecycle, and artifact contracts   | `packages/simulation-service/src/*.test.ts`                                                                        | existing Agent/MCP and browser wiring checks    |
| ngspice process/environment; ngspice/VACASK rawfile and results  | `packages/spice-run/src/*.test.ts`                                                                                 | qualified fixture and hosted smoke checks       |
| Agent authentication, permissions, and session lifetime          | `packages/agent-adapter/src/{session-state,service,request-contract}.test.ts`                                      | browser Agent session workflow                  |
| Browser recovery and persistence hardening                       | editor document unit contracts                                                                                     | recovery dialog and hardening Playwright specs  |
| User-visible editing workflows                                   | focused editor unit contracts                                                                                      | `apps/editor/e2e/` scenarios                    |
| Validation policy and change-impact selection                    | `scripts/lib/{validation-gates,ci-validation-plan,verify-pr-selection,test-impact}.test.mjs`                                           | focused required browser checks, small fallback |

Timing report accounting is protected by
`scripts/lib/e2e-durations.test.mjs`; elapsed run time and cumulative retry cost
remain distinct. Workflow tests protect required-result propagation and parity
between local release commands and CI steps.

A change touching several rows adds a cross-module test only for the shared
fact, without repeating lower-level cases in Playwright.

Recorded rawfiles are parser fixtures, package builders module fixtures,
browser Projects workflow fixtures; a shared Project is fine, but each layer
asserts only its own contract.
