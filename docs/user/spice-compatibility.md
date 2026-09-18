# SPICE Compatibility

Analog Canvas imports circuit structure; importing does not simulate the
netlist. Every source byte, continuation, include relation, typed statement,
and unresolved statement remains available to the compiler pipeline. Spectre
`.scs` entries are converted to SPICE in the browser before this import.

The editor exports deterministic structural SPICE (`.spi`) and Spectre
(`.scs`) netlists from the typed schematic Project. Exported files deliberately
omit model cards, library includes, simulator decks and analyses. Libraries,
sections and corners belong to authored simulation source. Unknown
imported `X` calls remain external subcircuit calls; a display mapping never
turns them into a primitive model call.

For the exact reviewed SKY130 targets, the editor uses the existing NMOS,
PMOS, resistor, capacitor, and inductor artwork while retaining an external
definition. A user may place the ordinary NMOS/PMOS with the unchanged Insert
flow, then choose `sky130_fd_pr__nfet_01v8`, `sky130_fd_pr__pfet_01v8`, their
exact `01v8_lvt` variants, or another reviewed MOS master in the component's
`netlistTarget` (**Target netlist**) property. The edit creates or reuses the
project-local external definition, preserves connectivity, and exposes `w`,
`l`, `nf`, and `m`. The same undoable edit changes the Reference `M1` to `XM1`;
clearing the target restores `M1`. It does not convert `m` into `nf`.

The same `netlistTarget` property on ordinary resistors and capacitors offers
`sky130_fd_pr__res_high_po` and `sky130_fd_pr__cap_mim_m3_1`. Their existing
icons and visible pins do not change. The resistor's real B substrate terminal
is selected from existing Nets through `Substrate Net` in Properties and
has no canvas pin or wire. Physical R/C geometry is `w/l/mult` or `w/l/mf`;
the editor never derives it from an ideal scalar value.

The ordinary PNP symbol similarly offers the exact fixed
`sky130_fd_pr__pnp_05v5_W0p68L0p68` wrapper. It keeps the visible C/B/E pins,
prints a three-node external X call, and relies on that wrapper's internal
substrate-to-collector connection. The exact
`sky130_fd_pr__npn_05v5_W1p00L1p00` interface instead exposes its real fourth S
terminal as a `Substrate Net` property and is structural only in the hosted
Profile. Clearing its `netlistTarget`, or choosing an ordinary model name,
restores the ordinary three-node Q card and removes the model-only substrate
membership. The generic Diode remains model-bearing structural only; this
hosted environment does not claim a qualified SKY130 diode or NPN target.

This convenience is structural only. It does not install SKY130, resolve a
local `.include`, supply foundry models or corners, or make the exported
netlist simulatable by itself. Unreviewed masters, incompatible terminal order,
and external definitions with explicit block presentation continue to render
as generic blocks.

Imported `.subckt` parameter defaults become editable Cell formal parameters
and are emitted again. Required-only Cell parameters remain an authoring
concept but cannot be exported by the released portable dialects until they
have explicit defaults. Independent `V`/`I` sources can be edited and exported
with DC, AC, PULSE, SIN, or PWL values, but structural import maps only their
DC form back to editable source parameters.

| Profile               | Structural status       | Detection                                                   | Important limit                                                |
| --------------------- | ----------------------- | ----------------------------------------------------------- | -------------------------------------------------------------- |
| ngspice 46 core       | baseline                | ngspice directives                                          | simulator commands are preserved, not executed                 |
| SPICE3f5 core         | baseline                | compatibility fallback                                      | no simulator execution                                         |
| LTspice 24 structural | selected vendor profile | `.backanno` family or explicit override                     | schematic directives and proprietary devices may remain opaque |
| Xyce 7 structural     | selected vendor profile | analysis-qualified `.print`/`.measure` or explicit override | Xyce expression/runtime semantics are not evaluated            |
| HSPICE                | preservation only       | no dedicated profile                                        | no released conformance corpus                                 |
| PSpice                | preservation only       | no dedicated profile                                        | no released conformance corpus                                 |

“Opaque” is not discarded. It means the exact source and source span are kept,
but the statement is not yet safe to turn into editable circuit semantics.
