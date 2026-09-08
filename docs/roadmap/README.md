# Remaining Product Work

Roadmaps contain unfinished outcomes and acceptance questions. Current behavior
belongs in [specifications](../specs/README.md); implementation and delivery
evidence belong in commits and pull requests. A file's existence or a module's
unit tests do not establish end-to-end completion.

## Active boundaries

| Outcome                           | Remaining boundary                                                                                                                                  | Acceptance owner                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Simulation integration            | Cross-Project reuse, authorized Project operations, and one-candidate complete human/Agent journey                                                  | [Simulation remaining work](simulation-remaining-work.md)                             |
| Accessible manual editing         | Semantic canvas navigation and keyboard alternatives to pointer-only operations                                                                     | Editor interaction; [current limits](../user/troubleshooting.md#accessibility-limits) |
| Connectivity consumer closure     | Verify all production consumers use canonical read/geometry/location contracts; remove any reachable duplicate paths only with parity evidence      | Derived/Edit Engine/editor owners                                                     |
| Named-Net/export closure          | Verify the complete lifecycle and dialect matrix together, not just isolated resolver success                                                       | Derived/netlist/import/editor owners                                                  |
| Portable release human acceptance | Install the PWA from the packaged local host; import/place/wire/save/restart/restore/export an original circuit; record candidate and artifact hash | Release owner                                                                         |
| Hosted Agent delivery             | Confirm a deployed grant → edit → undo → revoke journey, credential isolation, and bounded resource access for the release candidate                | Agent/Worker/release owners                                                           |

The last three rows are acceptance reviews, not claims that the implemented
index, search, trace, naming, or Agent resources are missing. Close them with
linked candidate evidence; investigate only gaps that the review actually finds.

## Connectivity and naming acceptance

Use the current [connectivity](../specs/connectivity-and-routing.md),
[netlist](../specs/netlist-export.md), and
[diagnostic](../adr/0015-object-locator-and-diagnostic-envelope.md) contracts.
The acceptance review must cover:

- One occurrence-aware location path for search, trace, highlight, and check
  navigation, including two instances of the same child Cell.
- Shared resolved Route geometry for rendering, hit testing, attachment,
  dragging, diagnostics, and formal export; stable leg remapping through
  split, normalization, stretch, and deletion.
- Manual and Agent behavior for free ends, bends, loops, Junctions, groups,
  copy/paste, placement contacts, direct-pin separation, locked geometry, and
  route-bound annotations. Refactoring cannot discard a difficult corner.
- Wire cut → Base-Net partition → owner reconciliation → endpoint readiness,
  with undo/redo, reset, save/reopen, NoConnect, MOS bulk, imported provenance,
  local/global markers, and pin-to-pin contacts.
- Distinct disconnected local/global equal names; physical joins and subsequent
  cuts; project-wide canonical global spelling; dialect token collisions;
  explicit generic versus Cadence spelling; source hints after edits; Ground
  `0`; and owner-scoped Properties changes without topology mutation.
- Permutation-stable spelling, structural reparse of emitted netlists, and
  unchanged physical identity/ownership where only name projection changes.
- ERC versus advisory visual findings, explicit Check and Save invalidation,
  and the absence of editor-only overlays from formal exports.
- The [performance workloads](../specs/performance.md), especially avoiding
  repeated full-Document scans per Net and expensive pointer-move recomputation.

These are regression and closure obligations, not a new Net protocol, an
automatic rerouter, or a requirement to restore retired APIs.

## Execution discipline

Select a bounded target and its owner before implementation. Use the current
[working rules](../../AGENTS.md) and [test policy](../testing/README.md), rather
than copying gate commands into each roadmap. Use
[the phase template](phase.template.md) only when a genuinely staged outcome
needs a separate plan.

An unresolved requirement must be resolved, explicitly deferred, or retained
with an acceptance boundary. It must not disappear because an old checklist is
removed, nor be marked complete because a foundation module landed.
