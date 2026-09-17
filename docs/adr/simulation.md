# Simulation Architecture

Status: `accepted`

Owners: `packages/netlist`, `packages/simulation-service`, `packages/spice-run`,
`apps/editor`, `worker`, `containers`

## Decision

Keep simulation authoring, compilation, execution and results separate.
[Simulation](../specs/simulation.md) owns source intent and Canvas mapping;
[execution](../specs/simulation-execution.md) owns Profiles, runs and artifacts;
[results](../specs/simulation-results.md) owns numeric evidence and judgments.

## Context

Testing an edited circuit should not require a second circuit model or an
invented testbench. Native control languages and model environments also cannot
be reduced to a collection of duplicated UI settings.

## Rationale

Source folders preserve the author's experiment. Canvas-bound circuit values
remain electrical facts; digest-guarded mapped edits use the same transactions
as Properties. A textual testbench can own its source without falsely claiming
a proven mapping to Canvas. Helpers edit that authority rather than maintain a
parallel configuration.

Shared preparation and File artifacts give human and Agent execution the same
meaning. Freezing prepared inputs makes freshness explicit; results remain
evidence of that experiment, never writes back into the circuit.

Configured native executors support hosted and optional local execution without
maintaining a browser solver or discovering arbitrary installed tools. The cost
is controlled input upload, isolation and operational maintenance. Profiles
select engines and qualified models; a familiar device symbol does not establish
simulatability, and a matching digest does not prove electrical correctness.

Raw evidence, units and captured measurements make judgments reproducible.
Missing data must stay missing rather than be fabricated for a plot or verdict.
Engine qualification and deployment are separate from architectural availability;
the [remaining qualification work](../roadmap/vacask-migration.md) is not an
accepted-capability claim.
