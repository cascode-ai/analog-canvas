# SPICE Compatibility

Import preserves each source line, include and unrecognised statement. Canvas
converts Spectre `.scs` entries to SPICE in the browser before import.

Structural SPICE (`.spi`) and Spectre (`.scs`) exports include the circuit's
declarations, such as [model cards](../specs/netlist-export.md#generic-models)
when needed. Unknown imported `X` calls stay external subcircuit calls.
Use the [Testbench](analog-simulation.md) for analyses and simulator setup.

## SKY130 targets

In Properties, use **Target netlist** to choose a reviewed model for the
selected part and fill its required fields. See the
[device mappings](../specs/netlist-export.md#persisted-data-model),
[process presets](../specs/netlist-export.md#process-configuration) and
[substrate rules](../specs/netlist-export.md#substrate-and-negative-supplies).
For local runs, [supply the simulator dependencies](analog-simulation.md#run-it-yourself).
For hosted execution, use the
[qualified Profile](../specs/simulation-execution.md#hosted-sky130-profile).

## Parameters and sources

Imported `.subckt` defaults become editable Cell parameters and are exported
again. Required parameters without defaults block export. Independent
voltage and current sources import supported DC, AC, PULSE, SIN and PWL
values into editable fields. The [SPICE frontend](../specs/spice-frontend.md#expressions-and-elaboration)
preserves source expressions the editor cannot map to fields.

| Profile | Status | Detection | Limit |
| --- | --- | --- | --- |
| ngspice 46 core | baseline | ngspice directives | simulator commands kept, not executed |
| SPICE3f5 core | baseline | fallback | no simulator execution |
| LTspice 24 structural | vendor profile | `.backanno` family or override | schematic directives and proprietary devices may stay opaque |
| Xyce 7 structural | vendor profile | analysis-qualified `.print`/`.measure` or override | expressions not evaluated |
| HSPICE | preservation only | none | no conformance corpus |
| PSpice | preservation only | none | no conformance corpus |

"Opaque" means kept exactly, with its source location, but not yet turned
into editable circuit semantics.
