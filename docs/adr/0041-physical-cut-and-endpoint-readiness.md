# 0041 - Physical cut and endpoint readiness

Status: `accepted`

Date: `2026-08-23`

Owners: `packages/edit-engine`, `packages/derived`, `packages/netlist`,
`packages/agent-adapter`, `apps/editor`

## Context

The current model correctly separates physical Base Nets from derived Logical
Nets, but two remaining shortcuts contradicted that boundary. `cut_connection`
could preserve one Base Net when it was imported, global, or already had more
than one routed component. ERC then treated membership in any Base Net as proof
that an ordinary pin was connected. Consequently deleting a Wire could leave
real logical connectivity behind, while an isolated singleton pin could pass
ERC, Gallery, or a structural Check Report.

Hierarchy tracing also addressed a Net by Document alone. Two instances such
as X1 and X2 that reuse one child definition could therefore be traversed as if
they were the same occurrence. Finally, the derived Logical-Net representative
was described as stable although it can change after split, merge, pruning, or
Evidence edits.

## Decision

- `cut_connection` always partitions the affected Base Net by explicit Routes
  and confirmed coincident endpoint contacts. Logical name, global, import, or
  explicit-equivalence Evidence never suppresses the physical split.
- The component containing the deleted Route's `from` endpoint (or `to` if the
  former was an orphan Junction removed by the cut) retains the original
  Base-Net ID and non-owner Evidence. Other components receive deterministic
  new IDs. Owner-addressed Evidence follows its surviving marker, Port, or
  annotation; it is not copied blindly.
- Route-anchored annotations are an explicit deletion closure. Planners remove
  them first through typed edits; raw Route deletion rejects while a live
  anchor remains.
- One pure derived endpoint assessment separates membership (`unbound`,
  `singleton`, `peer-connected`) from accepted intent (explicit NoConnect,
  implicit pin, formal boundary, global supply). ERC, Gallery gates, and the
  editor Check Report/export review consume this assessment. Check and Save
  deliberately remains a non-judgmental persistence action and cannot block or
  mislabel unfinished drawings. The assessment is not persisted.
- Cross-Cell Net references include `HierarchyFrame[]`. Down traversal appends
  the concrete instance frame and up traversal may pop only that same caller.
- A derived Logical-Net ID is a deterministic, revision-scoped Base-Net
  representative, not persistent identity. Agent Snapshot clients refresh all
  Net IDs after any revision change.

This supersedes only ADR 0035's clauses that require a normal cut to retain
imported membership. `remove_route_geometry` remains the explicit
presentation-only operation and imported routing guidance remains derived.

## Alternatives considered

### Preserve imported/global membership and repair only ERC

- Benefits: smaller Edit Engine change.
- Costs: Wire Delete would still not mean electrical disconnect and export
  could retain a connection the user removed.
- Reason not selected: it preserves the Base/Logical-Net layer violation.

### Add a persisted endpoint lifecycle or readiness object

- Benefits: consumers could read a stored status directly.
- Costs: creates another electrical protocol, stale derived state, migrations,
  and synchronization requirements.
- Reason not selected: readiness is completely derivable from current model
  facts and explicit intent.

## Consequences

### Positive

- Wire Delete has one electrical meaning in authored, imported, global, and
  partially routed circuits.
- ERC, Gallery, and Check Report no longer disagree about singleton pins;
  Check and Save remains independent of those judgments.
- Reused Cell definitions no longer cross-connect X1 and X2 traces.
- No new Project schema, Net object, or Lifecycle Manager is introduced.

### Negative or limiting

- Deleting an imported Wire intentionally marks source connectivity modified;
  re-import guidance cannot silently restore the cut component.
- Route-attached annotations are removed with their Route instead of being
  retained at a fallback position.
- Snapshot consumers cannot cache derived Net representatives across edits.

## Compatibility and migration

The Project schema and rolling reader are unchanged. Existing projects are
reinterpreted only when a new cut is committed or readiness is derived. Agent
API version remains 2.0; generated schema descriptions clarify the existing
revision fence rather than adding a field.

## Validation

- Delete/undo/redo tests for ordinary, imported, global, partial, named, and
  direct-contact Nets.
- Endpoint assessment and ERC tests for every membership and accepted intent.
- Gallery and Check Report tests proving the same current-revision result.
- X1/X2 repeated-child hierarchy trace and navigation tests.
- Agent Snapshot schema/documentation checks for revision-scoped Net IDs.

## Related documents

- [ADR 0035](0035-imported-net-routing-guidance.md)
- [ADR 0040](0040-connectivity-evidence.md)
- [Connectivity and routing](../specs/connectivity-and-routing.md)
- [Agent Circuit API](../specs/agent-api.md)
