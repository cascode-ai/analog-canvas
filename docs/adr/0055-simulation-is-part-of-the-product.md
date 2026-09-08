# ADR 0055: Simulation is part of the product

Status: accepted

Date: 2026-09-01

Owners: `packages/model`, `packages/netlist`, `packages/simulation-service`,
`packages/spice-run`, `apps/editor`, `apps/local-host`, `worker`,
`containers/ngspice`

## Context

A schematic-to-export-only workflow separates the circuit from the experiment
that tests it. The product closes that loop without implementing a numerical
solver, duplicating electrical extraction, or guessing the author's Testbench.

## Decision

Simulation is a product capability with distinct authoring, compilation,
execution, and result boundaries.

- A named Project setup owns one structured or raw input. Structured input
  references an ordinary Testbench Cell, independently of the Project top.
  Several setups may share that Cell; its DUTs remain ordinary Cell instances.
- Sources and loads are ordinary circuit Instances. Their DC, AC, and waveform
  parameters are not copied into setup overrides.
- Structured preparation reuses deterministic design-netlist extraction and
  compiles the requested analyses and acquisitions. Raw preparation preserves
  authored intent; it does not invent analyses, sources, or a root call.
- Simulatability means supported native primitives or models supplied by the
  selected environment, recursively through hierarchy. It does not require a
  PDK model for an ideal resistor. Unsupported blocks are diagnosed by identity.
- Saved setup intent is Project data; prepared input, receipts, artifacts, and
  results are execution data. A result cannot mutate circuit facts. Bounded
  server retention and session result comparison do not create Project history.
- GUI and Agent use the same SimulationService, executor contract, and File
  artifacts. Preparation freezes inputs; a changed input makes a result stale,
  never silently rebinds it.
- Hosted ngspice runs in the operator-managed container behind the configured
  gateway/Tunnel, not inside a Worker isolate. The local host is an optional,
  explicitly configured adapter, with no automatic binary or PDK discovery.
- The hosted environment is a digest-pinned, startup-verified Profile.
  Qualification covers named devices, analyses, corners, and numeric tests,
  not the entire PDK. Matching binaries/models remove environmental differences;
  they do not prove every numerical disagreement is an export defect.
- Execution is bounded and isolated. Cancellation terminates the process tree;
  unknown completion never causes an automatic duplicate run. Raw control
  language requires the same isolation as structured input.
- Numbers and units come from validated simulator evidence. Missing data is
  diagnosed rather than fabricated; display decimation does not alter export.
- Preview qualifies a candidate before Production promotion under
  [ADR 0057](0057-release-channels-preview-and-production.md).

Current analyses, Profile scope, retention limits, resource operations, and
failure semantics belong to the [simulation specifications](../specs/simulation.md),
not a second release-scope list in this ADR.

## Alternatives and consequences

Browser WASM would require maintaining a simulator build and distributing model
data to each client. Local-only execution would exclude hosted users.
A configured native executor supports both deployment locations behind one
semantic boundary, but hosted execution uploads circuit input and requires
explicit authorization, resource controls, and operational maintenance.

A separate simulation circuit model would diverge from export and connectivity.
A guessed Testbench would answer an experiment the author did not request.
Neither is introduced. Saved authored intent improves reproducibility; it does
not claim that a run with a matching image is electrically correct without
model-backed acceptance.

## Validation

Compiler tests protect deterministic preparation and unchanged Project facts.
Closed-form fixtures protect numeric parsing and units. Model-backed Profile
qualification compares the compiled circuit and reference under the same
declared experiment. Runtime tests protect isolation, cancellation, limits,
and failure evidence; deployed Preview checks protect the actual hosted path.

See [deployment](../deployment.md) for candidate qualification and promotion.
