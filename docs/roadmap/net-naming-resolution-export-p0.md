# Net Naming, Global Projection, and Export Plan

Status: `proposed`

Owners: `packages/derived`, `packages/netlist`, `apps/editor`

## Objective

Close the naming defects that can make an exported netlist express different
electrical connectivity from the schematic, then establish deterministic
spelling and Cadence-compatible round-trip behavior, without changing physical
connectivity or Net lifecycle behavior.

This is a Net naming/resolution/export boundary target. It is not a
connectivity-lifecycle target. Delivery is ordered as the separately committed
C0 lifecycle correction, P0 naming correctness, P1 naming authority and
dialect capability, then P2 source-spelling compatibility.

## Why this is P0

The schematic currently distinguishes Logical Nets with scoped name identity,
while extraction eventually emits plain simulator tokens. If scope or
project-wide spelling is discarded before those tokens are proven unique, two
distinct schematic Nets can become one simulator node, or one intended global
Net can become multiple simulator nodes.

Two correctness cases must be impossible:

```text
one Cell contains local VDD and global VDD
-> both export as VDD
-> the global declaration silently promotes and shorts the local node
```

```text
top Cell spells a global VDD and a child Cell spells the same global vdd
-> extraction preserves two spellings
-> a dialect may interpret them as two nodes instead of one project global
```

Export must either produce one deliberate identity, produce two provably
distinct dialect tokens, or block with a precise diagnostic. It must never
silently change connectivity.

## Naming model

The existing persisted authority remains:

```text
Base Net
  + owner-addressed name-claim { name, scope, owner, powerDomain? }
  + formal Cell-Pin names
  + non-authoritative import provenance
        |
        v
Document Logical-Net resolver
        |
        v
Project global-name projection
        |
        v
Dialect identifier codec and collision check
        |
        v
DesignNetlistIR
```

- `BaseNet.id` and terminal membership remain the physical authority.
- `name-claim` remains the only editable Label/marker naming authority.
- `LogicalNet.id` remains a revision-scoped derived handle.
- `spice-source` and `net-name-hint` remain provenance only.
- Project-global spelling and encoded dialect tokens are transient export
  projections. They are not persisted identities.

## Scope rules

The intended authoring rules are:

- an ordinary Net Label defaults to `local`;
- VDD/power markers and Power Rails default to `global`;
- Ground is the global reference node `0`;
- imported explicit `.global` facts remain global declarations;
- a Label may explicitly edit its existing `scope` claim between `local` and
  `global` through the normal owner-addressed evidence edit path;
- two disconnected claims with the same visible spelling but different scopes
  remain distinct Logical Nets;
- when the same physically connected Logical-Net group carries the same name
  in both scopes, its effective scope is derived as `global`; owner claims are
  not rewritten. Different names or incompatible power roles remain conflicts.

The last rule changes the current accepted conflict policy and therefore
requires the corresponding ADR/spec amendment in the implementation target.
It does not authorize a new persisted promotion state.

Because `VDD` may legally denote a local Net while another `VDD` is global,
the editor must expose scope in Properties. A compact Global badge or equivalent
presentation cue is required before this coexistence is treated as ordinary
UI, but that cue has no electrical authority.

## Case and identity rule

Schematic Net identity remains case-insensitive, matching the current
`foldNetName()` contract and ngspice-style node identity:

```text
VDD == vdd == Vdd
```

Original case remains spelling, not electrical identity. Scope remains part of
identity, so disconnected local `VDD` and global `vdd` are still different
Logical Nets. A Spectre or compatibility codec may apply a different output
syntax, but it must not redefine schematic identity.

Changing this case-folded identity would require a dedicated ADR covering
import, Properties, resolver, hierarchy, compatibility, and migration. It is
not part of this plan.

## Spelling authority

The plan separates three concepts that must not be collapsed:

1. **Logical identity** decides whether authored claims denote the same
   Logical Net.
2. **Project spelling projection** selects one deterministic display/export
   spelling for every project-global identity and uses it in every reachable
   Cell.
3. **Dialect codec** converts that identity to a legal SPICE or Spectre token
   and checks uniqueness under that dialect's comparison rules.

The project-global projection retains every exact spelling variant and selects
one preferred spelling through this semantic priority:

```text
current visible Label or Power Marker
  (prefer the top Cell, then the nearest reachable hierarchy depth)
-> Cell Pin name
-> imported global declaration
-> source hint
-> generated name
```

Within the same priority tier, a stable lexical comparison selects the
preferred spelling. Evidence ID or incidental array order must not select it.
The projection exposes transient fields such as:

```typescript
spellings: readonly string[];
preferredSpelling?: string;
```

These fields are never persisted. Every Cell node reference and the project
global declaration consume the same preferred project spelling.

Multiple exact spellings for one case-folded identity are legal and produce a
non-blocking `GLOBAL_NAME_SPELLING_NORMALIZED`-class diagnostic that lists the
variants and selected output spelling. Labels continue to display their own
authored text; normalization never rewrites owner claims. Properties may show
the preferred export spelling and all variants.

This plan deliberately chooses stable automatic selection plus a warning. It
does not block export merely because `VDD` and `vdd` occur on the same identity.

## Dialect name codec

One pure codec boundary converts preferred semantic names to output tokens:

```typescript
encodeNetName({ name, scope, dialect, namingProfile }) => ({
  token,
  collisionKey,
  diagnostics,
});
```

It owns legal characters, reserved words, escaping, the target's case
comparison, global output form, and encoded-token collision checks. Project
projection decides that a Net is named `VDD`; the codec decides how the target
format can represent it.

The SPICE target uses ngspice semantics: node identity is case-insensitive,
Ground is node `0`, and global scope is emitted with `.global`. The Spectre
target has its own syntax and collision rules. The current shared portable
identifier subset remains the P0 safety baseline, then P1 replaces it with
explicit target codecs.

The shared model must not reject a valid authored name merely because the old
portable ASCII subset cannot print it. Conversely, a codec must not strip
punctuation, fold display case, or append a suffix to an authoritative name
when doing so can change identity.

When two distinct Logical Nets map to one dialect token, extraction returns a
blocking `NET_NAME_COLLISION`-class diagnostic naming both Nets, their scopes,
and the conflicting token. Automatic `__2` disambiguation remains permitted
only for non-authoritative source hints or generated unnamed local Nets, never
for an authored Label, Cell Pin, or global declaration.

## Cadence `!` compatibility

Core semantic state remains clean and typed:

```text
name = VDD
scope = global
canvas = VDD plus a Global indicator
```

Default ngspice and Spectre export use their explicit global declarations.
Cadence bang-style is an explicit import/export naming profile, not a new Net
type and not a second persisted Net name. When selected, it may encode the
same semantic global as `VDD!` according to the target format. The profile is
operation configuration and is not persisted in the Project.

Cadence-compatible import of `vdd!` separates semantic and lexical facts:

```yaml
name-claim:
  name: vdd
  scope: global
net-name-hint:
  sourceName: vdd!
```

Generic SPICE import must not unconditionally remove `!`, because outside the
explicit compatibility profile it may be part of the literal node name. This
plan therefore chooses an explicit Cadence-compatible profile rather than
guessing from punctuation.

## Source spelling policy

Source spelling remains provenance and requires no new lifecycle state. Output
selection follows:

```text
current authored name-claim
-> project-global preferred spelling
-> one unambiguous source hint encodable by the target
-> generated name
```

`sourceStatus` does not enable or disable individual source hints. It is a
Document-level statement about source correspondence; an unrelated edit must
not invalidate every useful Net spelling. `connectivity-modified` means exact
source round-trip is no longer promised, while safe hints may still be reused.

An authored rename or newly placed marker wins without deleting provenance.
After a Wire cut, existing evidence-copy rules remain authoritative. If two
resulting Nets retain the same source hint, the exporter may disambiguate those
non-authoritative hints and report it; it must not reconnect the Nets.

## Prerequisite C0 - Imported-global split allocation

This is a separate P0 connectivity-correctness target that must land before the
naming P0 work. It is recorded here because a stale imported global authority
can invalidate every later spelling/export guarantee, but it is not part of
the naming implementation boundary.

The importer correctly maps an explicit source declaration:

```spice
.global VDD
```

to an authoritative global `name-claim` owned by `global-declaration`. The
defect occurs later: the common split propagation currently copies that
non-spatial declaration to every Base-Net component after `cut_connection`.
The resolver then joins those components again by global scoped name, so the
physical split does not become an electrical/netlist split.

The accepted split allocation is:

| Evidence after cut                 | Allocation                                                                |
| ---------------------------------- | ------------------------------------------------------------------------- |
| `spice-source`                     | Copy to every surviving component as provenance.                          |
| `net-name-hint`                    | Copy to every surviving component as non-electrical spelling provenance.  |
| `global-declaration`               | Keep only on the primary component that retains the original Base-Net ID. |
| Label or Power Marker `name-claim` | Continue following its existing spatial owner to the surviving component. |

No importer mapping, schema, resolver rule, project-global projection, or new
lifecycle state is required. The existing split algorithm already chooses the
primary component and retains the original Base-Net ID, so retaining the
original declaration requires no second ownership rule. The existing
connectivity transaction continues setting `sourceStatus` to
`connectivity-modified`.

Required C0 acceptance scenarios:

1. Cutting an imported global with no spatial name owner produces two Base
   Nets and two Logical Nets; only the primary remains global.
2. When both resulting components independently retain same-name Global
   Markers, they remain two Base Nets but intentionally resolve to one global
   Logical Net.
3. When only one component has a current global owner, the other component
   does not inherit global scope from source provenance.
4. Both components retain their `spice-source` and `net-name-hint` evidence,
   and imported routing guidance remains non-electrical.
5. Undo and redo restore the exact Base-Net, evidence, Logical-Net, and
   `sourceStatus` results.

### Separate delivery boundary

- C0 owns only split evidence allocation and its focused Edit Engine/derived
  regression tests.
- C0 must be committed and reviewed independently from resolver spelling,
  project-global projection, dialect codec, and Properties changes.
- Naming P0-P2 commits must not use C0 as permission to rewrite the common
  connect/cut/split lifecycle.
- A test that only observes physical Base-Net partitioning is insufficient;
  C0 must assert post-cut Logical-Net resolution and exported connectivity.

## Accepted product decisions

| Decision                         | Accepted policy                                                                                                                     |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Schematic case identity          | Case-insensitive through the existing folding contract; exact case is spelling only.                                                |
| Equal-identity spelling variants | Select deterministically by semantic priority and lexical tie-break, then warn; do not block or rewrite owners.                     |
| Cadence bang interpretation      | Enable only through an explicit import/export compatibility profile; never infer electrical scope from punctuation in generic mode. |
| Source-hint eligibility          | Current authority wins; Document-level `sourceStatus` does not globally disable safe hints.                                         |
| Persistence                      | Keep one authored `name-claim`; preferred spelling, variants, codec tokens, and profiles remain transient.                          |

## Strict implementation boundary

The following boundary applies to the naming P0-P2 work packages. Prerequisite
C0 is the separately committed correction described above and is the only
planned change to split evidence allocation.

### Allowed changes

- pure Logical-Net name and effective-scope resolution;
- the project-level global index and canonical spelling projection;
- netlist extraction, dialect codecs, and collision diagnostics;
- Properties editing of the existing `name-claim.scope` field;
- a presentation-only Global indicator;
- focused tests and the accepted specs/ADR required by these semantics.

No new persisted field is required.

### Systems that must remain unchanged

- `connect_endpoints` and `merge_nets`;
- `cut_connection` and `disconnect_endpoint`;
- connected-components partitioning;
- Base-Net split and stable-ID allocation;
- terminal, Route, and Junction reassignment;
- Label/marker evidence migration by owner;
- orphan-Net pruning;
- `sourceStatus` transitions;
- imported-provenance copying;
- undo/redo;
- reset/clear;
- hierarchy occurrence identity and traversal.

The implementation must not:

- rewrite every same-name Label to `global` after contact;
- add a scope-promotion or scope-demotion lifecycle;
- persist a hidden logical connection;
- modify source provenance to preserve a naming result;
- invoke Base-Net merge/split operations from a Label scope or spelling edit.

The required behavior is purely derived:

```text
Wire connect/cut
-> existing physical Base-Net transactions run unchanged
-> existing owner evidence follows the resulting Base Nets unchanged
-> resolver recomputes names and effective scope for the new revision
-> export projection and codec recompute output tokens
```

## Work packages

### P0 - Exported connectivity correctness

### WP-P0.1 - Characterize the electrical boundary

- Add fixtures for local/global same-spelling Nets, cross-Cell global spelling,
  `VDD!`, node `0`, and dialect collisions.
- Snapshot physical topology and lifecycle state before changing the resolver
  or exporter.
- Main modules: `packages/derived`, `packages/netlist` tests and fixtures.

### WP-P0.2 - Resolve effective scope without persisted promotion

- Derive global effective scope for one already-connected, same-name group
  containing local and global owner claims.
- Keep disconnected local/global groups distinct.
- Preserve all existing Base-Net and evidence ownership mutations.
- Main module: `packages/derived`.

### WP-P0.3 - Project one global identity and spelling

- Extend the project global index with a deterministic canonical spelling.
- Apply that projection to every reachable Cell before IR construction.
- Diagnose contradictory global identities instead of repairing Project data.
- Main modules: `packages/derived`, `packages/netlist`.

### WP-P0.4 - Block output-token collisions

- Compute target comparison keys for the currently supported identifier
  subset.
- Block local/global and cross-identity collisions before printer invocation.
- Do not automatically rename authored Labels, Cell Pins, or globals.
- Main module: `packages/netlist`.

### P1 - Spelling authority and dialect capability

### WP-P1.1 - Preserve variants and select preferred spelling

- Add derived `spellings` and `preferredSpelling` projections.
- Implement the accepted semantic priority and lexical tie-break.
- Emit normalization warnings without rewriting owner claims.
- Main modules: `packages/derived`, `packages/netlist`.

### WP-P1.2 - Introduce ngspice and Spectre codecs

- Centralize per-dialect identifier validation/encoding.
- Detect local/global and encoded-token collisions before printer invocation.
- Keep generated-name and non-authoritative hint disambiguation deterministic.
- Main module: `packages/netlist`.

### WP-P1.3 - Expose authored scope and spelling safely

- Edit only the selected Label's existing owner-addressed scope claim.
- Show scope, preferred export spelling, and variants without treating the
  projection as editable persisted state.
- Show enough presentation information to distinguish equal visible
  local/global names.
- Reuse the existing transaction, validation, undo, and redo paths.
- Main module: `apps/editor`; supporting typed edit only if the existing edit
  surface cannot express the field change.

### P2 - Cadence spelling and source round-trip

### WP-P2.1 - Add the explicit Cadence bang profile

- Normalize bang-style source spelling only when the profile is selected.
- Preserve the exact source token as a non-electrical hint.
- Encode typed globals using the target profile without changing their semantic
  name or scope.
- Main modules: `packages/spice`, `packages/netlist`, import/export UI.

### WP-P2.2 - Complete source-spelling selection

- Apply the accepted authored/project/hint/generated precedence.
- Keep hint eligibility independent of Document-level `sourceStatus`.
- Diagnose ambiguous or disambiguated hints and never claim exact round-trip
  after connectivity modification.
- Main modules: `packages/netlist`, import/export UI.

Each work package is a separate bounded implementation target unless its
changed files and validation surface clearly coincide with an adjacent package.

## Acceptance scenarios

| Scenario                                                                          | Required result                                                                                                       |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Disconnected local `VDD` and global `VDD` in one Cell                             | They remain distinct. Export emits distinct legal tokens or blocks; it never silently shorts them.                    |
| A local `VDD` Wire is physically connected to a global `VDD` marker               | The existing Base Net is unchanged by naming logic; the derived Logical Net is global and exports consistently.       |
| That Wire is cut                                                                  | Existing split/evidence ownership decides the new Base Nets; the resolver recomputes scope without promotion history. |
| Top `VDD` and child `vdd` are one global identity under the accepted folding rule | Every Cell reference and the global declaration use one canonical project spelling/token.                             |
| One identity has visible spellings `VDD`, `vdd`, and `Vdd`                        | Export selects one spelling by semantic priority, reports all variants, and does not rewrite any Label.               |
| Two distinct identities encode to the same dialect token                          | Export blocks with a collision diagnostic referencing both Logical/Base Nets.                                         |
| An authored literal name is `VDD!` in generic SPICE mode                          | It remains literal and is encoded or rejected by ngspice rules; punctuation is never silently stripped.               |
| Cadence-compatible import reads global `vdd!`                                     | Semantic state is global `vdd`, exact `vdd!` remains provenance, and the canvas need not display the suffix.          |
| The same Project exports normally and with Cadence compatibility                  | Both outputs preserve one electrical identity; only the selected lexical representation changes.                      |
| Ground marker                                                                     | It remains global node `0`; no naming projection creates an alias.                                                    |
| Label scope changes through Properties                                            | Only that owner's claim changes; physical membership, Routes, Junctions, provenance, and unrelated claims do not.     |
| Undo/redo of a scope edit                                                         | Existing project transaction semantics restore exactly the prior/new evidence and derived export result.              |

## Regression invariants

For identical physical editing operations before and after this work, tests
must prove equality of:

- Base-Net connected-component partitions and stable-ID allocation;
- terminal, Route, and Junction ownership;
- owner-addressed evidence reassignment after split;
- orphan pruning and `sourceStatus`;
- imported provenance;
- undo/redo and reset/clear state transitions;
- hierarchy occurrence edges.

Only these outputs may change:

- Logical-Net name/effective-scope resolution;
- project-global grouping and canonical spelling;
- exported node/global tokens;
- naming, scope, representability, and collision diagnostics;
- Properties/presentation of the existing scope fact.

## Deterministic validation

- focused `packages/derived` Logical-Net and project-index tests;
- focused `packages/netlist` extraction and SPICE/Spectre golden tests;
- order-permutation tests proving spelling output is independent of evidence ID
  and Project array order;
- paired generic/Cadence profile fixtures proving identical electrical identity
  with intentionally different spelling;
- structural SPICE reparse for every successfully emitted fixture;
- focused editor Properties tests for the existing scope edit;
- existing edit-engine connect, cut, split, evidence migration, lifecycle,
  reset, and undo/redo regressions with no golden-state changes;
- `pnpm gate:affected -- --base <base-ref>` for each implementation target;
- the repository mainline delivery gate before merge.

## Out of scope

- PDK lookup, model libraries, simulation profiles, corners, or analyses;
- physical connectivity algorithms or lifecycle redesign;
- persisted Logical-Net IDs or Logical-Net lineage;
- hierarchy-occurrence redesign;
- bus naming and vector expansion;
- source-text round-trip beyond preserving typed provenance;
- automatic inference that arbitrary names such as `VDD`, `AVDD`, or `DVDD`
  are global merely because of their spelling.

## Phase exit gates

- C0 is complete when cutting an imported global cannot regain connectivity
  through copied declaration authority, while provenance, owner-following,
  source status, and undo/redo retain their existing contracts.
- P0 is complete when no successful export can collapse two distinct schematic
  Net identities, all reachable references use one project-global spelling,
  and unchanged connectivity/lifecycle fixtures produce byte-identical
  physical state.
- P1 is complete when spelling selection no longer depends on evidence IDs or
  array order, variants are explainable, and ngspice/Spectre codecs prove every
  emitted token under their own rules.
- P2 is complete when Cadence bang-style import/export is explicit and
  deterministic, source hints follow the accepted precedence, and modified
  Documents make no false exact-round-trip claim.

Dependent netlist-import/export closure work may then rely on project-global
identity and dialect spelling as explicit, tested boundaries.
