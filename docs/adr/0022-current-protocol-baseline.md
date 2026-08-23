# 0022 - Current protocol baseline

Status: `accepted`

Date: `2026-08-17`

Owners: `packages/model`, `packages/edit-engine`, `packages/derived`,
`packages/agent-adapter`, current normative documentation

## Context

Several intentional product changes landed after their original specifications:
Project schema 10 added Instance value annotations, schema 11 restored RichText
fractions, the attempted first-class canvas Port model was reverted, the typed
Edit Engine union grew, and the deployable Agent connection added credential
rotation and connector resume. Current implementation, regression tests, public
artifacts, and completed target evidence agree, but some accepted ADR examples
and normative prose still describe older contracts.

Accepted ADRs remain immutable historical records. This ADR records which old
clauses are superseded and establishes one current baseline without rewriting
their remaining decisions. It does not decide ADR 0014/R10 consumer migration,
route-geometry cleanup, or possible dead code in that subsystem.

## Decision

### Project schema

The only accepted persisted Project format is schema 11.
`CURRENT_PROJECT_SCHEMA_VERSION`, `CircuitProjectSchema`, parsing, persistence,
recovery, import, fixtures, and user documentation use that current-only
contract. Older and newer Project schemas are rejected; no migration registry
or compatibility-shaped in-memory model exists.

Other independently namespaced `schemaVersion` fields, such as symbol assets,
visual-reference manifests, and compatibility-corpus envelopes, are not Project
schema alternatives and retain their own versions. Negative tests may construct
non-11 Project values solely to prove rejection.

### Canvas interface markers and formal cell terminals

`port` and `port-filled` are ordinary single-pin Symbol Instances with pin `P`.
They use the same placement, transform, terminal membership, Route endpoint,
clipboard, delete, Snapshot, and rendering paths as every other component.
There is no Port object collection, Port Net membership, Port Route endpoint,
Port locator kind, or Port-specific edit kind.

Formal hierarchical interfaces are represented separately by the ordered
`Document.netlist.terminals` mapping and parent Instance pins. SPICE Circuit IR
and DesignNetlistIR may call their transient cell-interface records `ports`;
those compiler/export structures do not create canvas Port objects.

### Typed edit union

`SchematicEditSchema` in `packages/edit-engine` is the sole executable registry
of typed edit kinds. GUI and Agent mutations ultimately use that union. The
Agent derives its advertised permitted subset from the union and adds only the
explicit high-level `wireIntent` capability named `wire`; `wire` is not a
`SchematicEdit` member. Hand-maintained alternate edit unions and retired
`place_port` / `move_port` operations are invalid.

The normative edit-kind summary is checked against the executable union in
tests so a kind change requires coordinated documentation.

### Agent credential lifetimes

The deployed defaults are accepted as one bounded credential hierarchy:

- Claim: 30 minutes. A valid repeat redemption rotates both credentials and
  invalidates the previous pair.
- Bearer: at most 8 hours, never persisted, never outliving the session.
- Session and connector: 7 days. The local Agent Helper may persist only the
  connector in its private user profile; the relay stores only a verifier.
- Completed-request idempotency result: 5 minutes, additionally bounded by
  entry count and aggregate bytes.

Connector resume rotates the bearer without widening Project, Document, or
permission scope. Session revoke, expiry, or Project replacement invalidates
the Claim, bearer, and connector together. Browser recovery stores neither
Agent credential. The longer Claim hand-off window and session-bound persistent
connector are accepted usability/security tradeoffs because secrets are
high-entropy, verifier-only at rest in the relay, scope-bound, replaceable, and
visibly revocable; they do not authorize silent Project retargeting.

## Superseded clauses

- ADR 0010's reference to Project schema 9 is superseded by schema 11; its
  RichText and drafting authority remains accepted.
- ADR 0013, ADR 0014, and ADR 0015 examples that include a first-class Port,
  Port endpoint, Port locator, or hierarchy-port object are superseded by the
  ordinary Instance/formal-cell-terminal split above. Their connectivity,
  geometry, locator, diagnostic, and staged R10 judgments otherwise remain in
  force.
- ADR 0016's five-minute one-time Claim, one-hour bearer, refresh-terminal
  behavior, and absence of connector resume are superseded by the lifecycle
  above and ADR 0020. Its browser-authoritative relay, scoped permission,
  Project binding, revision, idempotency, and no-second-mutation-engine
  decisions remain accepted.

## Alternatives considered

### Restore implementation to the oldest accepted prose

- Benefits: no ADR supersession work.
- Costs: discards intentionally shipped schema, Port rollback, Agent API, and
  connection-lifecycle behavior already protected by tests and public artifacts.
- Reason not selected: historical prose is the drift source, not evidence that
  the later behavior was accidental.

### Keep duplicate model and edit compatibility paths

- Benefits: old callers might continue to parse.
- Costs: reintroduces ambiguous Port identity, multiple mutation languages, and
  unsupported Project shapes.
- Reason not selected: the product is deliberately current-only and already
  rejects those shapes.

### Restore ADR 0016's shorter lifetimes

- Benefits: narrows exposure after a disclosed Claim or bearer is stolen.
- Costs: breaks the accepted connection and restart workflow; ignores connector
  rotation, private storage, and explicit revoke added later.
- Reason not selected: current values are accepted with the bounded credential
  hierarchy and invalidation requirements above. Future lifetime changes require
  a coordinated security decision, implementation change, tests, and docs.

## Consequences

### Positive

- Current code, public contracts, and normative documentation describe one
  Project, endpoint, edit, and credential model.
- Drift tests make future schema, edit-kind, and TTL changes explicit.
- Historical ADR reasoning remains available without being mistaken for the
  current superseded clauses.

### Negative or limiting

- Consumers cannot open older Project files through the product.
- The 30-minute Claim and 7-day connector/session require users and hosts to
  protect disclosed/persisted secrets and retain a reliable revoke path.
- R10 geometry migration remains a separate unresolved architecture target.

## Compatibility and migration

No Project migration is introduced. Existing canonical schema-11 files and
ordinary Port-symbol Instances are unchanged. Removed first-class Port and
retired edit shapes remain rejected. Agent clients retain the same four Circuit
operations and receive the existing connector/bearer lifecycle.

Current specs and Agent knowledge are updated to this ADR. Historical plans,
logs, rejected-shape tests, and superseded ADR text remain as evidence and do
not become compatibility inputs.

## Validation

- model persistence and compatibility-corpus tests;
- model documentation/version drift test;
- Edit Engine documentation/union drift test;
- Agent session expiry, rotation, resume, revoke, and documentation/TTL tests;
- generated Agent/MCP artifact checks;
- branch-wide static, unit, build, and production-smoke verification.

## Related documents

- [`0010-text-annotation-drafting-schema.md`](0010-text-annotation-drafting-schema.md)
- [`0013-project-connectivity-index.md`](0013-project-connectivity-index.md)
- [`0014-resolved-route-geometry.md`](0014-resolved-route-geometry.md)
- [`0015-object-locator-and-diagnostic-envelope.md`](0015-object-locator-and-diagnostic-envelope.md)
- [`0016-browser-authoritative-agent-session.md`](0016-browser-authoritative-agent-session.md)
- [`0020-agent-side-mcp-adapter.md`](0020-agent-side-mcp-adapter.md)
- [`../specs/schematic-model.md`](../specs/schematic-model.md)
- [`../specs/edit-engine.md`](../specs/edit-engine.md)
- [`../specs/web-agent-session.md`](../specs/web-agent-session.md)
