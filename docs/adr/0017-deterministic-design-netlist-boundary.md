# 0017 - Deterministic Design-Netlist Boundary

Status: `accepted`

Owners: `packages/model`, `packages/components`, `packages/netlist`

## Decision

Use one validated, transient electrical IR and pure dialect printers for
[design-netlist export](../specs/netlist-export.md#authorities).
[Simulation preparation](../specs/simulation.md) composes explicit simulator
setup with that structural boundary; visual export remains separate.

## Context

The same edited schematic must produce consistent SPICE and Spectre, whether
it was drawn manually or imported. Source preservation, drawing presentation
and executable simulation setup have different authorities.

## Rationale

Printing separately from the Project in each dialect would duplicate hierarchy,
pin ordering, naming and validation. Reusing import Circuit IR would confuse
source syntax and provenance with the edited design's electrical intent.
Patching original source cannot represent arbitrary manual schematic edits.

The normalized export boundary keeps both printers deterministic and makes
missing electrical intent explicit. Component definitions own reviewed device
facts; generated device and symbol registries are projections, not competing
sources. Simulation adds explicitly selected environment and analysis intent
rather than asking the structural exporter to guess it.
