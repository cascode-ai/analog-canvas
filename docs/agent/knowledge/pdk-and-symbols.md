# PDK models and symbols

Owner: Symbol registry and Edit Engine for facts; Agent reasoning for proposing
a reviewed mapping. Strength: hard for pin identity, guidance for visual choice.
Trigger: unresolved/generic symbols, model-backed devices, or a requested symbol
change.

## Evidence required

Preserve the exact source model, parameters, terminal count, terminal order, and
existing Net membership. Prefer mappings in this order:

1. explicit session/project import override;
2. exact reviewed model mapping;
3. reviewed PDK-scoped rule with the same terminal count;
4. primitive mapping supported by the parsed model type;
5. unresolved generic symbol.

SKY130 `sky130_fd_pr__nfet_*` and `sky130_fd_pr__pfet_*` four-terminal devices
map to product NMOS/PMOS pins `D,G,S,B`. That rule does not apply to another
namespace or terminal count.

The mapped external definition keeps its immutable external Symbol ID and `X`
binding; only its presentation borrows the base MOS artwork. Omit the base
symbol's default three-terminal variant so the external contract exposes the
fourth bulk terminal. An explicit external block presentation overrides this
automatic artwork choice.

## Safe symbol replacement

Use `set_instance_symbol` with an explicit source-pin to target-pin map whenever
connected or routed pins are renamed. Let the Edit Engine update Net terminals,
Route terminal endpoints, and `spice.pin.*` atomically. A rejected duplicate,
missing, or unknown target pin is a mapping error, not permission to detach the
device.

## Counterevidence and failure modes

Text such as `nfet`, a transistor-like instance name, or a four-terminal count
alone does not prove pin order or bulk semantics. Do not discard source model or
parameters after normalization. An explicit mapping to a generic visual block
is still resolved knowledge and should not emit an unresolved-symbol warning.
