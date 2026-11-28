# Simulation Architecture

Status: `accepted`
Owners: `packages/netlist`, `packages/simulation-service`, `packages/spice-run`, `apps/editor`, `worker`, `containers`

Authoring, compilation, execution and results stay separate
([simulation](../specs/simulation.md),
[execution](../specs/simulation-execution.md),
[results](../specs/simulation-results.md)).

- Source folders keep the author's experiment; Canvas-bound values stay circuit
  facts; results never write back into the circuit.
- Shared preparation gives human and Agent runs one meaning.
- Configured executors, not a browser solver or tool discovery; Profiles
  select engine and qualified models.
- Missing data stays missing in plots and verdicts.
