# Model binding and symbol replacement

Preserve exact model identity, parameters, ordered external terminals and Net
membership. A symbol is a presentation, not proof of a simulator model or pin
mapping. Prefer an explicit Project/import mapping or a reviewed exact mapping;
leave an unresolved generic symbol when the required facts are absent.

Structural mapping is not simulation qualification. Obtain supported devices,
corners, engine and dependency identities from the selected Profile's current
capabilities, not a static count of SKY130 wrappers. Model-symbol information,
when advertised, is tied to a dependency digest and section. Do not infer support
for an entire family from one accepted device.

Use Snapshot external binding and `mosBulk` facts to check hidden body/substrate
pins. Three-terminal artwork does not remove an electrical fourth terminal.
Do not discard an external binding merely to obtain familiar artwork.

A SKY130 NPN's hidden substrate `S` (and a poly resistor's or varactor's `B`,
an inductor's `SUB`) is the p-substrate, the node NMOS bodies sit on. It is
bound when the part is placed: to the Cell's one drawn negative supply (a
supply marker named like `VEE`, `VSS` or `VNEG`) while the Cell's NMOS body
default is unset or ground (a Cell's first ground sets it), else to that
default when it is another Net, else to ground. To put it elsewhere, set the
NMOS default, e.g. `{kind:"set-mos-bulk-default",mos:"nmos",net:"VSUB"}`: the
substrates that followed the old default move with the NMOS bodies, one set
to another Net stays. One bound to ground before the rail was drawn exports
with `PDK_SUBSTRATE_ABOVE_NEGATIVE_SUPPLY`; rebind it alone with
`set_property_terminal_net`, or, with ground the NMOS default, set that
default to the rail. A SKY130 PNP has no substrate pin: its wrapper ties the
substrate to its collector, so it netlists with three nodes.

For `set_instance_symbol`, use an explicit source-to-target pin map when
connected or routed pins change names. The Edit Engine updates the related
terminal and route identities atomically. Duplicate/missing/unknown target pins
are mapping failures, not permission to detach the device. Query exact edit
fields through the selected transport's schema.
