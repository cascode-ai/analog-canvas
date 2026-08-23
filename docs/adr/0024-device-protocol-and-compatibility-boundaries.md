# 0024 - Device protocol and compatibility boundaries

Status: `accepted`

Date: `2026-08-17`

Owners: `packages/model`, `packages/devices`, `packages/project-protocol`,
`packages/symbols`

## Context

Project schema 11, rolling schema-10 Project compatibility, and the current
device behavior are accepted contracts. The implementation currently groups
current model schemas in one large source file, keeps Project parsing and
serialization inside `@icm/model`, and distributes built-in device netlist
facts across model and symbols. That makes a device change span more files than
the contract requires and leaves compatibility as a model concern rather than a
file-boundary concern.

The product must preserve existing device behavior. In particular, Symbol IDs,
pins, variants, reference prefixes, required parameters, SPICE/Spectre output,
MOS bulk behavior, connectivity, and schema-11 Project bytes are already
reviewed behavior, not candidates for reinterpretation during modularization.

## Decision

### Current model stays current-only

`@icm/model` owns only the current normalized model and its current structural
invariants. Its source may be organized by schema responsibility, but it does
not own historical Project parsing, an old runtime shape, or a compatibility
serializer.

### Built-in device protocol is a dedicated registry

`@icm/devices` owns one descriptor registry for built-in device facts:

- existing Symbol association;
- canonical pins and netlist pin order;
- device class, reference prefix, required parameters, target policy, and
  supported dialects;
- current capabilities such as MOS bulk support.

The first registry keys descriptors by existing `symbolId`. It does not add a
persisted device identity, change Instance JSON, change Symbol semantics, or
become another mutation engine. Symbol geometry and variants remain owned by
`@icm/symbols`; parity between the two contracts is tested.

### Project compatibility is one file-boundary module

`@icm/project-protocol` owns JSON parsing, structured diagnostics, the rolling
current-and-previous version check, the one direct previous-to-current adapter,
and current-only canonical serialization. It returns one current
`CircuitProject` or structured diagnostics; failed input never replaces the
editor's current Project or silently changes the selected source file.

Project files retain one root `schemaVersion`. Code may split transformation
helpers by concern, but files do not gain independently mutable device,
routing, or annotation version fields.

### Compatibility remains bounded

The reader accepts only the current Project version and exactly one named
previous version. A previous input is transformed directly and then validated
through current schemas. Serialization writes only the current version. When a
new Project schema is needed, the previous-to-current adapter replaces the
earlier adapter; old schemas, types, serializers, fixture archives, and
migration chains are removed rather than accumulated.

Only deterministic transformations are allowed. Ambiguous electrical facts
are rejected rather than inferred.

### Protocol changes are deliberate

Symbol artwork, UI behavior, a new device expressible by current Instance data,
and internal refactors do not advance Project schema. A new required persisted
field, pin rename/order change, parameter representation change, MOS bulk
persistence change, or any changed electrical meaning does require a Project
schema decision, direct adapter, focused migration tests, and documentation.

## Alternatives considered

### Keep all responsibilities in model and symbols

- Benefits: no package or import changes.
- Costs: device and persistence concerns remain duplicated and cross-cutting.
- Reason not selected: the current dependency layout obscures the real
  ownership boundaries and raises the cost of safe device iteration.

### Persist independently versioned protocol modules

- Benefits: individual payloads could evolve independently.
- Costs: creates a version-combination matrix without an independently
  deployed plug-in ecosystem.
- Reason not selected: code-level modules provide the maintenance boundary
  without making Project files harder to reason about.

### Retain a historical migration registry and fixtures

- Benefits: support arbitrary old Projects.
- Costs: retained runtime states and test assets grow indefinitely.
- Reason not selected: ADR 0023's bounded N-1 direct migration gives the
  required user path while keeping one current runtime contract.

### Add automatic degraded loading and repair

- Benefits: some damaged visual data might remain viewable.
- Costs: data-loss and electrical-inference risks, plus a second recovery
  product surface.
- Reason not selected: the normal loader stays strict; any repair workflow
  requires separate evidence and an explicit save-as contract.

## Consequences

### Positive

- Built-in device behavior has one reviewable authority.
- Project compatibility is isolated at the ingestion/serialization boundary.
- Current model code is smaller and easier to navigate without making its
  persisted format modular or multi-versioned.
- Future device changes have a clear schema-upgrade decision rule.

### Negative or limiting

- The extraction changes package imports across model, symbols, netlist, and
  editor boundaries.
- The first registry preserves `symbolId` coupling; a future device-identity
  split remains a separate protocol change.
- Strict loading still rejects invalid Project files, although it reports
  structured errors and preserves the active editor Project.

## Compatibility and migration

The initial extraction preserves schema 11, canonical Project bytes, the
schema-10-to-11 direct upgrade, and all current device behavior. It introduces
no Project migration. When a later persisted change advances the schema, it
replaces the one adapter as defined in ADR 0023.

Canonical repository fixtures stay current-only. Tests may contain small local
raw prior-version inputs for the exact fields a direct adapter transforms; they
do not constitute a historic fixture collection.

## Validation

- descriptor/Symbol/netlist parity for every built-in device;
- existing MOS bulk and typed netlist behavior;
- current and previous Project parse/serialize/reopen contracts;
- editor staged-file and recovery contracts;
- type, documentation, focused package, branch, and mainline validation.

## Related documents

- [`0022-current-protocol-baseline.md`](0022-current-protocol-baseline.md)
- [`0023-rolling-previous-project-compatibility.md`](0023-rolling-previous-project-compatibility.md)
- [`../specs/schematic-model.md`](../specs/schematic-model.md)
- [`../specs/project-file-format.md`](../specs/project-file-format.md)
- [`../specs/persistence-and-recovery.md`](../specs/persistence-and-recovery.md)
