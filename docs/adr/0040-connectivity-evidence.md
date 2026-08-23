# ADR 0040: Base Nets, Net Markers, and Logical Nets

Status: accepted

Date: 2026-08-23

Schema: schema 22

## Context

The editor previously let `Net.name`, power-role fields, marker annotations,
and SPICE provenance act as independent electrical authorities. Repeated VDD
or Ground symbols could therefore look equivalent while diagnostics, export,
highlight, and routing guidance disagreed. Destructive same-name merges also
made removing one label alter connectivity owned by another label.

## Decision

The runtime has one connectivity model with three deliberately different
layers:

1. A **Base Net** is physical topology only: terminal membership plus Routes
   and Junctions that reference its stable ID. Physical contact may merge Base
   Nets; equal text never does.
2. A **Net Marker claim** is an owner-addressed electrical naming fact. Net
   Labels, Free Ports, VDD/Ground symbols, and Power Rails all use the same
   `name-claim` shape. A claim owns `name`, `scope`, and optional `powerDomain`.
   SPICE source identity and explicit equivalence are additional evidence fed
   to the same resolver, not alternate naming protocols.
3. A **Logical Net** is the pure derived equivalence class used by ERC, search,
   highlight, routing guidance, export, Agent snapshots, and topology hashes.
   Matching folded names join only within the same scope. Conflicting names,
   scopes, or power roles are errors; no source silently wins.

Power Rail and VDD are not separate electrical objects. Power Rail is a draw
gesture and Route presentation; VDD and Ground are marker symbol
presentations. VDD, AVDD, DVDD, and node `0` are ordinary names. Power markers
default to global scope; ordinary Net Labels and Free Ports default to local
scope. AVDD and DVDD remain separate because their names differ, even though
both carry the `vdd` role.

A formal Cell Port remains a hierarchy interface. Its ordered terminal name
is an export/interface fact and its canvas markers are ordinary Instances. It
does not become a Free Port or a second Net naming API. A formal terminal name
may differ from the internal Logical-Net name; repeated markers reuse the
terminal by its Net binding, not by turning the interface name into a claim.

`upsert_connectivity_evidence` and `remove_connectivity_evidence` are internal
typed edits used by reviewed planners. The public Agent surface reads resolved
Logical Nets but cannot mutate evidence or raw Base-Net naming fields. The old
`set_net_name`, `set_net_power_domain`, and named `connect_endpoints` inputs are
removed.

Schema-21 `Net.name`, `Net.scope`, `Net.powerDomain`, and `Net.origin` members
remain only as inert schema-22 storage projections for the rolling file reader.
No runtime resolver, editor planner, diagnostic, exporter, or Agent contract
uses them as authority. Their physical removal is a schema-format cleanup, not
another electrical migration.

Device identity stays orthogonal:

- Symbol Definition owns pins and artwork;
- Instance owns stable object ID, emitted netlist reference/binding, and
  placement;
- Presentation owns schematic reference text and RichText annotations.

Changing Net semantics therefore cannot change Razavi geometry, hit areas,
labels, or insertion gestures.

## Consequences

- Repeated VDD/Ground markers are legal and resolve by name without physically
  merging their Base Nets.
- Removing the last marker removes only its claim; unrelated topology and
  imported source evidence survive according to their own owners.
- A GND/VDD marker placed on an independently named signal is rejected instead
  of silently renaming or aliasing the signal.
- All electrical consumers receive the same canonical Logical-Net ID and
  conflict set.
- Visual appearance and established user gestures are unchanged; only the
  underlying electrical authority is consolidated.
