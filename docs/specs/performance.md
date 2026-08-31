# Performance Budgets

Status: `accepted`

Primary owner: `scripts/performance-baseline.mjs`

## Representative workload

The release benchmark uses a deterministic generated Project with 500 placed
two-terminal instances and 499 logical nets. It measures canonical save,
formal SVG render, a bounded Agent summary query, and one atomic Edit Engine
transaction. SPICE import is measured against the checked ngspice baseline
corpus. A second deterministic workload with 200 Nets, 200 Routes, 400
Junctions, and 200 route-bound Net Labels protects the document connectivity
index from accidental per-Net full-document rescans.

## CI-safe budgets

| Operation                                    |   Budget |
| -------------------------------------------- | -------: |
| Generate and validate representative Project | 2,000 ms |
| Canonical serialize                          | 1,000 ms |
| Formal SVG render                            | 2,000 ms |
| Bounded Agent summary query                  | 1,000 ms |
| One-instance Edit Engine transaction         | 1,000 ms |
| Build multi-Net document connectivity index  | 1,000 ms |
| ngspice baseline import                      | 2,000 ms |

These are release regression ceilings, not UI latency claims. The benchmark
records measured values and environment metadata. It performs warm-up and uses
whole-operation timings; unit tests assert structure, while the release script
enforces budgets.

## Change policy

A budget increase requires a recorded reason and a representative fixture
review. A faster developer machine is not evidence for lowering a budget.
