# ADR 0052: Net-name authority and source provenance

Status: accepted

Date: 2026-08-31

Owners: `packages/model`, `packages/derived`, `packages/spice`,
`packages/netlist`, `packages/edit-engine`, `packages/project-protocol`

## Context

Schema 33 removed ownerless Net equivalence, but `explicit-net-property`
remained a hidden `name-claim`. SPICE import used it to retain source node
spelling, while the Logical-Net resolver treated that spelling exactly like a
visible Net Label. Composing two Documents that both contained an imported
`OUT`, `BIAS`, or `VDD` property could therefore connect electrically even
though no copied Label, Cell Pin, power marker, or global declaration explained
the connection on the schematic.

The same hidden claim also survived unrelated editing lifecycles. Deleting a
visible marker could leave a Route electrically named by import metadata, and
cutting or copying topology required special handling for a name whose owner
the user could neither see nor select.

## Decision

Current electrical naming has only these authorities:

1. A visible Net Label owns a scoped name claim.
2. A power marker or Power Rail owns a scoped name claim and optional supply
   role.
3. Equal folded Cell-Pin names in one Document identify one Logical Net. The
   independently authored terminal and Base-Net objects remain intact. One
   unique Port spelling also supplies the current Logical-Net name; multiple
   different Cell Pins on one internal Net remain interface aliases until a
   visible Label or marker chooses its current name.
4. SPICE node `0` and `.global` declarations own explicit global name claims.
   Globality is never inferred merely because a spelling resembles a supply.

Imported ordinary node spelling is persisted as `net-name-hint`. A hint is
provenance for inspection and deterministic netlist round-trip; it never names,
joins, protects, or conflicts with a Logical Net. `spice-source` continues to
record source Net identity for routing provenance and is also non-electrical.

Netlist export first uses current authoritative names. An otherwise unnamed
Logical Net may reuse one valid source hint if the spelling is available. A
collision is deterministically disambiguated (`OUT`, `OUT__2`, ...), and
ambiguous or unrepresentable hints fall back to generated names with a warning.
Two independent Base Nets are never emitted under the same node token merely
because they share a hint.

## Editing and composition

- Adding a visible Label does not rewrite or adopt a source hint. The Label
  becomes the current electrical name; the hint remains provenance.
- Cutting imported topology propagates source identity and name hints to the
  resulting physical components, but those records cannot reconnect them.
- An explicit imported global declaration propagates across a split because a
  global name intentionally identifies disconnected drawing regions.
- Clipboard and cross-Document composition copy a hint with its Base Net but do
  not gain a connection from it. Copied visible owners, equal Cell Pins, and
  explicit globals keep their ordinary Logical-Net behavior.
- A whole-Net rename requires an editable visible owner. A Net with only a
  source hint must gain a Net Label or have its Cell Pin renamed.

## Compatibility

Schema 34 retires `explicit-net-property`. The 33→34 migration converts a
source-backed local property to `net-name-hint`, converts a source-backed global
property to a `global-declaration`, and assigns an existing visible power
marker/rail as owner where an older Project depended on a shadow power claim.
Other legacy hidden properties become non-electrical legacy hints rather than
silently retaining cross-Document connection authority.

## Consequences

- Gallery composition cannot short unrelated imported circuits through hidden
  ordinary node names.
- SPICE topology remains unchanged because terminal membership already owns the
  parsed source graph.
- Unmodified imports retain useful source spelling on export, while composition
  and split cannot emit accidental SPICE shorts.
- Every cross-Base-Net electrical identity is now explainable by a visible
  owner, a formal Cell Pin, or an explicit global source declaration.

## Related documents

- [ADR 0051](0051-owner-explainable-logical-nets.md)
- [Schematic Model](../specs/schematic-model.md)
- [Connectivity and Routing](../specs/connectivity-and-routing.md)
- [Project File Format](../specs/project-file-format.md)
