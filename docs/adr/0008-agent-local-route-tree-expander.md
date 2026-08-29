# ADR 0008: Agent-local RouteGraph expander

Status: `accepted`

Date: `2026-08-07`

Owners: `packages/agent-routing`, Agent authoring knowledge

## Context

An Agent can choose a readable multi-endpoint topology but should not have to
hand-calculate every Junction, bend, and Route edit. Persisting that planning
state, exposing it through the Circuit API, or letting a helper choose topology
would create a second circuit model and an implicit autorouter.

## Decision

`@icm/agent-routing` is an Agent-local, transient, pure-function helper. Its
`RouteGraph` input records the complete local topology already chosen by the
Agent: existing endpoints, explicit bends and branch Junctions, label anchors,
and `escape`, `link`, `trunk`, or `label` edges. `RouteGraphExpansion` produces
typed edits, resolved geometry, metrics, assumptions, and conflicts.

The graph and expansion types never enter Project JSON, `@icm/model`, or the
Agent Circuit API. They do not survive a transaction and introduce no query,
selection, region, or layout-intent protocol.

The helper resolves only the graph it receives. It does not choose topology,
insert omitted nodes, add elbows, change placement, switch to another shape,
or reroute around a conflict. Any conflict returns no edits; the Agent changes
the graph or placement and evaluates again. Optional constructors for common
direct, branch, trunk, island, and bus arrangements are editable starting
points, not a closed shape vocabulary.

Normal graph edges must already satisfy the helper's octilinear geometry
contract. This Agent-side restriction is independent of the editor's broader
free-angle Route authoring support.

## Consequences

- The Agent owns circuit interpretation and visible topology.
- The helper removes repetitive coordinate arithmetic without becoming a
  persisted model or automatic router.
- A caller may bypass the helper and submit ordinary reviewed Route edits.
- Unsupported geometry or incomplete graphs require an explicit Agent revision
  loop.

## Validation

- `packages/agent-routing` tests cover deterministic expansion and atomic
  conflict behavior.
- Agent API and Project schemas contain no `RouteGraph` type.
- Generated Agent knowledge describes the same detect-without-reroute boundary.

## Related documents

- [`0007-snapshot-driven-agent-workflow.md`](0007-snapshot-driven-agent-workflow.md)
- [`../specs/agent-api.md`](../specs/agent-api.md)
- [`../specs/connectivity-and-routing.md`](../specs/connectivity-and-routing.md)
- [`../agent/workflow.md`](../agent/workflow.md)
