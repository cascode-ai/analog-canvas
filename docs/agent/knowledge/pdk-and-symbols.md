# Model binding and symbol replacement

Preserve exact model identity, parameters, ordered external terminals and Net
membership. A symbol is presentation, not proof of a model or pin mapping:
prefer an explicit Project/import or reviewed exact mapping, and leave a
generic symbol unresolved when facts are missing. Structural mapping is not
simulation qualification: take supported devices, corners, engine and
dependency identities from the selected Profile's capabilities (model-symbol
information is tied to a dependency digest and section), and never infer a
family from one accepted device.

A Profile's `cellLibraries` declare the standard-cell libraries it defines and
how a deck loads them. Hosted SKY130 ngspice offers `sky130_fd_sc_hd`: Prepare
mounts and `.include`s the cell file after the models' `.lib`, and the cell is
called in its own pin order, `VGND VNB VPB VPWR` included (cells built from
`nfet_01v8` and `pfet_01v8_hvt` at `scale=1.0u`). Only the gate cells a
Library gate takes are reviewed; flip-flops, latches and other HD cells use
undefined `special_` devices. Refusals: `STANDARD_CELL_LIBRARY_UNAVAILABLE`
(library not offered), `STANDARD_CELL_UNSUPPORTED` (wrong pin order or no
Library gate). Any other body-less definition runs only as a reviewed library
interface in exact pin order or a `.subckt` in the experiment's files; a loaded
dependency alone is `MODEL_IMPLEMENTATION_MISSING`.

Check hidden body/substrate pins with Snapshot external binding and `mosBulk`;
three-terminal artwork keeps an electrical fourth terminal. Never discard an
external binding for familiar artwork.

A SKY130 NPN's hidden `S` (a poly resistor's or varactor's `B`, an inductor's
`SUB`) is the p-substrate. On placement it binds to the Cell's one drawn
negative supply (named like `VEE`, `VSS`, `VNEG`) while the NMOS body default
is unset or ground (a first ground sets it), else to that default, else
ground. Setting the NMOS default
(`{kind:"set-mos-bulk-default",mos:"nmos",net:"VSUB"}`) moves substrates that
followed the old one; one set to another Net stays. One bound to ground before
the rail was drawn exports `PDK_SUBSTRATE_ABOVE_NEGATIVE_SUPPLY`: rebind it
with `set-terminal-net` (`pin:"S"`, its Properties Substrate Net row), or set a
ground NMOS default to the rail. An inductor's `CT` is set the same way. A
SKY130 PNP has no substrate pin (its wrapper ties it to the collector; three
nodes).

`set_instance_symbol` needs an explicit source-to-target pin map when connected
or routed pins change names; the Edit Engine updates terminal and route
identities atomically. Duplicate, missing or unknown target pins are mapping
failures, not permission to detach the device.
