# SPICE Compatibility in v0.1

Interactive Circuit Maker imports circuit structure; it does not simulate the
netlist. Every source byte, continuation, include relation, typed statement,
and unresolved statement remains available to the compiler pipeline.

The editor exports deterministic structural SPICE (`.spi`) and Spectre
(`.scs`) netlists from the typed schematic Project. Exported files deliberately
omit includes, PDK model paths, simulator decks, corners and analyses. Unknown
imported `X` calls remain external subcircuit calls; a display mapping never
turns them into a primitive model call.

For the exact reviewed SKY130 targets, the editor uses the existing NMOS,
PMOS, resistor, and capacitor artwork while retaining an external definition.
A user may place the ordinary NMOS/PMOS with the unchanged Insert flow, then choose
`sky130_fd_pr__nfet_01v8` or `sky130_fd_pr__pfet_01v8` from the existing Model
field. The edit creates or reuses the project-local external definition,
preserves connectivity and the authored `M` reference, and exposes `w`, `l`,
`nf`, and `m`. SPICE derives `XM1` from authored `M1`; it does not convert `m`
into `nf`.

The same Model field on the ordinary resistor and capacitor offers
`sky130_fd_pr__res_high_po` and `sky130_fd_pr__cap_mim_m3_1`. Their existing
icons and visible pins do not change. The resistor's real B substrate terminal
is selected from existing Nets through `Body/Substrate Net` in Properties and
has no canvas pin or wire. Physical R/C geometry is `w/l/mult` or `w/l/mf`;
the editor never derives it from an ideal scalar value.

This convenience is structural only. It does not install SKY130, resolve a
local `.include`, supply foundry models or corners, or make the exported
netlist simulatable by itself. Unreviewed masters, incompatible terminal order,
and external definitions with explicit block presentation continue to render
as generic blocks.

Imported `.subckt` parameter defaults become editable Cell formal parameters
and are emitted again. Required-only Cell parameters remain an authoring
concept but cannot be exported by the released portable dialects until they
have explicit defaults. Independent `V`/`I` sources are editable and
round-trippable only for their released DC form.

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
