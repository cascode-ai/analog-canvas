---
name: circuit-layout
description: Reason about, lay out, route, generate, inspect, and refine transistor-level or passive circuit schematics through Interactive Circuit Maker. Use for complete-Snapshot circuit reading, typed Agent API edits, RouteGraph expansion, hierarchy or flat views, visual diagnostics, textbook/Razavi-style cleanup, or human/Agent handoff while preserving electrical topology.
---

# Circuit layout

Use the complete read-only circuit Snapshot as evidence, reason freely about the
circuit and its visual expression, and mutate it only through revision-safe
typed transactions. Do not produce or require a fixed Layout Intent object.

## Load the four layers

Read [references/manifest.md](references/manifest.md) and load guidance in this
order:

1. Always read the workflow before executing a layout target.
2. Read tool behavior before constructing an unfamiliar API request, typed
   edit, RouteGraph, movement, or render.
3. Read response semantics whenever interpreting a helper or API result.
4. Read circuit/style knowledge before placement, routing, visual refinement,
   or accepting a formal render.

Load detailed pattern, hierarchy, PDK, and collaboration cards only when task or
Snapshot evidence makes them relevant. A card name is not circuit evidence.

## Establish the contract

1. Start from the deployed OpenAPI capabilities example and require exactly
   `capabilities/snapshot/transact/render` for live product work. Use the
   advertised current API/Snapshot versions rather than a version remembered
   from this Skill.
2. Check permissions, edit kinds, limits, `documentId`, and `revision` before
   planning edits.
3. Require one complete selected Document: cell interface facts, every
   instance and resolved or connected pin, Nets and terminals, Routes,
   Junctions, annotations, groups,
   constraints, bounds, presentation, hierarchy context, and diagnostics.
4. Treat Snapshot as read-only evidence. Never return it as a replacement
   Document or Project.
5. Use only the published `3.0` capabilities/snapshot/transact/render contract;
   no query or compatibility operation exists.

Stop when pin mapping, bulk connection, model semantics, hierarchy binding, or
the authority to change topology is unavailable. Never fill an electrical fact
gap with a drawing convention.

## Reason, edit, and review

1. Establish electrical facts and counterevidence before functional hypotheses.
2. Choose a coherent placement and reserve route/label corridors.
3. Decide the complete visible topology of each active Net: endpoints, real
   branches, dot-free bends, trunks/rails, and attached labels.
4. Use the optional RouteGraph helper only to project the Agent's complete graph
   onto legal geometry and typed edits. The Agent—not the helper—owns topology.
5. Dry-run risky edits and commit against the exact current revision.
6. Read structured response fields and `resolvedRoutes`, then inspect
   diagnostics, crossings, flightlines, and a formal render.
7. Repair the smallest responsible area and repeat until both the structural
   and semantic visual gates pass.

On `STALE_REVISION`, discard stale assumptions, Refresh the Snapshot, and reason
again. On a lock conflict, preserve the human result and find another layout or
ask for a decision. When a transaction exceeds a limit, split only the edit
batch—not the circuit interpretation.

## Obey hard boundaries

- MUST preserve electrical topology unless the user explicitly requests a
  circuit change.
- MUST use the shared Edit Engine, current revision, and advertised edit kinds.
- MUST preserve locks and clear human-owned layout.
- MUST NOT merge Nets, change terminal membership, or add a Junction merely to
  make routing easier.
- MUST NOT treat a geometric crossing as connected without an explicit same-Net
  Junction.
- MUST NOT guess PDK pin order, hidden bulk mapping, or hierarchy target.
- MUST make every intended visible endpoint relation discoverable through a
  Route, real branch, placed port, rail, or attached local Net label.
- SHOULD retain a clear intentional crossing rather than add a confusing
  detour.
- MAY use helpers as deterministic scaffolding, but the workflow and judgment
  must remain valid with every helper disabled.

## Complete only after both gates

Structural gate:

- final revision is current;
- bidirectional pin/Net facts agree;
- intended endpoint coverage is complete;
- blocking diagnostics and unintended flightlines are resolved;
- no lock or mutation boundary was bypassed.

Semantic visual gate:

- formal render communicates signal flow, functional grouping, matching,
  hierarchy, and repetition;
- real Junctions, bends, and crossings are visually distinct;
- labels avoid active route/symbol corridors;
- no unexplained bump, hook, duplicate dot, tiny box, or wire reversal remains;
- shared device nodes such as CMOS gates/drains read as one functional relation
  when the electrical facts support it.

Zero diagnostics is not a visual acceptance result. Inspect the rendered image
and revise confusing but structurally valid topology. Report any intentional
warning or unresolved uncertainty with object IDs. Do not claim electrical
correctness without simulation evidence appropriate to the circuit.
