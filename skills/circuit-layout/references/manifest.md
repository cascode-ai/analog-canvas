# Circuit-layout guidance manifest

Compatibility: Agent API `3.0`; Snapshot `3.0`.

Canonical product guidance lives in `docs/agent/`. Resolve the paths below from
this repository and load only the layers required by the current stage.

## Four primary layers

| Stage or signal | Read | Strength |
| --- | --- | --- |
| Starting or resuming any layout/generation target | [`workflow.md`](../../../docs/agent/workflow.md) | Required process |
| Constructing API/edit/RouteGraph input or moving objects | [`tool-behavior.md`](../../../docs/agent/tool-behavior.md) | Runtime fact |
| Reading helper conflicts, transaction output, diagnostics, routes, or artifacts | [`response-semantics.md`](../../../docs/agent/response-semantics.md) | Runtime interpretation |
| Placing, routing, refining, or visually accepting a schematic | [`circuit-style-knowledge.md`](../../../docs/agent/circuit-style-knowledge.md) | Electrical hard boundary plus visual guidance |

For a full schematic-generation task, all four layers apply in order. For a
narrow review, load only the relevant layers. Do not replace them with a single
large prompt or persist their reasoning as Layout Intent.

## Detailed knowledge cards

| Evidence in the task or Snapshot | Read |
| --- | --- |
| Unfamiliar circuit, uncertain topology, or 100+ devices | [`circuit-reading.md`](../../../docs/agent/knowledge/circuit-reading.md) |
| Whole-page composition, hierarchy presentation, or labels | [`schematic-expression.md`](../../../docs/agent/knowledge/schematic-expression.md) |
| Route repair, crossings, Junctions, flightlines, or metrics | [`routing-and-diagnostics.md`](../../../docs/agent/knowledge/routing-and-diagnostics.md) |
| Fixed grid, typography, strokes, node rendering, Razavi profile, or pixel fidelity | [`razavi-visual-contract.md`](../../../docs/specs/razavi-visual-contract.md) |
| Choosing a multi-endpoint visible Net topology | [`route-tree-shapes.md`](../../../docs/agent/knowledge/route-tree-shapes.md) |
| Hierarchy, shared children, or roughly 100+ devices | [`hierarchy-and-large-circuits.md`](../../../docs/agent/knowledge/hierarchy-and-large-circuits.md) |
| Generic/model-backed symbols or PDK pin uncertainty | [`pdk-and-symbols.md`](../../../docs/agent/knowledge/pdk-and-symbols.md) |
| Existing human work, locks, stale revisions, or handoff | [`human-collaboration.md`](../../../docs/agent/knowledge/human-collaboration.md) |
| Shared source/emitter and paired input evidence | [`differential-pair.md`](../../../docs/agent/knowledge/patterns/differential-pair.md) |
| Shared control and reference/output branch evidence | [`current-mirror.md`](../../../docs/agent/knowledge/patterns/current-mirror.md) |
| Repeated weighted or serial passive/switch branches | [`arrays-and-ladders.md`](../../../docs/agent/knowledge/patterns/arrays-and-ladders.md) |
| Clocked switches, sampling, alternate references, or bit branches | [`switching-and-sampling.md`](../../../docs/agent/knowledge/patterns/switching-and-sampling.md) |

Cards are evidence and shape menus, not API taxonomies, automatic classifiers,
or fixed recipes. Snapshot/import facts and model validators remain authoritative
for electrical topology.
