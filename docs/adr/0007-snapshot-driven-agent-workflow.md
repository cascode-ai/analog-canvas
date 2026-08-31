# ADR 0007: Snapshot-driven Agent workflow

Status: `accepted`

Date: `2026-08-11`

Owners: `packages/agent-adapter`, `packages/edit-engine`, Agent transports

## Context

Automation must operate on the same typed Project and transaction authority as
the interactive editor. Giving an Agent pixels, a mutable Project clone, or a
second electrical model would make revisions, validation, and undo semantics
depend on the transport that initiated the edit.

## Decision

The domain-facing Agent contract has four operations:

1. `capabilities` reports the supported contract and operation surface;
2. `snapshot` returns a revision-bound semantic view of the current Project;
3. `transact` submits typed edits against exact expected revisions; and
4. `render` produces deterministic presentation from committed state.

The Snapshot is read-only and intentionally smaller than the persisted Project.
Opaque object IDs and Logical-Net representatives are valid only for the
Snapshot revision that exposed them. A transaction is atomic, validated by the
Edit Engine, and rejected when its revision precondition is stale. Successful
mutation requires a fresh Snapshot before further identity-sensitive edits.

The generated Agent API owns exact request/response shapes and its independently
versioned protocol number. HTTP, browser-session, MCP, and future transports are
adapters over this domain contract; they do not add alternate edit semantics.
File open/save and Project replacement remain persistence operations, not a
fifth Agent mutation model.

## Consequences

- Editor and Agent edits share validation, connectivity, and undoable Project
  transitions.
- Retries can be idempotent without accepting stale object references.
- Transport authorization and deployment can evolve independently of circuit
  semantics.
- Pixel interpretation is optional evidence, never the electrical authority.

## Related documents

- [`0005-transport-independent-agent-api.md`](0005-transport-independent-agent-api.md)
- [`0016-browser-authoritative-agent-session.md`](0016-browser-authoritative-agent-session.md)
- [`0020-agent-side-mcp-adapter.md`](0020-agent-side-mcp-adapter.md)
- [`../specs/agent-api.md`](../specs/agent-api.md)
- [`../specs/web-agent-session.md`](../specs/web-agent-session.md)
