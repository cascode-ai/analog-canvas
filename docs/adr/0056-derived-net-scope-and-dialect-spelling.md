# ADR 0056: Derived Net Scope and Dialect Spelling

Status: `accepted`

Date: `2026-09-02`

Owners: `packages/derived`, `packages/netlist`, `apps/editor`

## Context

Net scope and output spelling were being treated as one fact. That makes two
unsafe outcomes possible: a local and global Net can collapse onto one
simulator token, while one project-global Net can acquire different spellings
in different Cells.

## Decision

- Each visible Label or marker continues to own one persisted `name-claim`
  with its authored `name` and `scope`.
- Disconnected equal-folded local and global claims remain distinct Logical
  Nets.
- If equal-folded local and global claims are already on the same physical
  Logical-Net group, its effective scope is derived as global. No owner claim
  is promoted or rewritten.
- Project-global spelling is selected transiently from current owner claims,
  Cell Pins, declarations, and source hints in that order. Exact variants are
  retained for explanation.
- A target-specific codec converts the selected semantic spelling to an
  ngspice or Spectre token and blocks collisions between distinct identities.
- Cadence bang spelling is an explicit operation profile, never persisted
  scope and never inferred in generic SPICE mode.

## Consequences

Connecting same-name local and global conductors is an explicit physical
contact and resolves global. Cutting them relies only on the existing Base-Net
partition and owner-evidence allocation, after which scope is derived again.
Naming logic adds no promotion lifecycle, hidden equivalence, or physical edit.

Distinct schematic Nets are never silently shorted by export spelling. Source
hints may be disambiguated, but authoritative authored names cause a blocking
diagnostic when the selected dialect cannot represent them uniquely.

## Related documents

- [`0052-owner-explainable-net-authority.md`](0052-owner-explainable-net-authority.md)
- [`../specs/schematic-model.md`](../specs/schematic-model.md)
- [`../specs/netlist-export.md`](../specs/netlist-export.md)
- [`../roadmap/net-naming-resolution-export-p0.md`](../roadmap/net-naming-resolution-export-p0.md)
