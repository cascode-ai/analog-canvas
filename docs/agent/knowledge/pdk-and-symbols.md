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

For `set_instance_symbol`, use an explicit source-to-target pin map when
connected or routed pins change names. The Edit Engine updates the related
terminal and route identities atomically. Duplicate/missing/unknown target pins
are mapping failures, not permission to detach the device. Query exact edit
fields through the selected transport's schema.
