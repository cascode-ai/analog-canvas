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
3. primitive mapping supported by the parsed model type;
4. unresolved generic symbol.

Only the four released exact SKY130 masters are mapped: the 1.8 V NFET/PFET,
`res_high_po`, and `cap_mim_m3_1`. Both exact master name and ordered public
interface must match. No `sky130_fd_pr__nfet_*`, resistor, or capacitor family
regular expression is an electrical authority.

The mapped instance keeps its external binding while borrowing native artwork.
Its authored reference remains in the native M/R/C domain; SPICE derives the X
card. MOS exposes D/G/S/B electrically, resistor R0/R1 map to frozen pins 1/2
and B is property-only, and MIM C0/C1 map to frozen pins 1/2. An explicit
external block presentation overrides automatic artwork choice.

## Safe symbol replacement

Use `set_instance_symbol` with an explicit source-pin to target-pin map whenever
connected or routed pins are renamed. Let the Edit Engine update Net terminals,
Route terminal endpoints, and `spice.pin.*` atomically. A rejected duplicate,
missing, or unknown target pin is a mapping error, not permission to detach the
device.

## Counterevidence and failure modes

Text such as `nfet`, a transistor-like Instance Reference, or a four-terminal count
alone does not prove pin order or bulk semantics. Do not discard source model or
parameters after normalization. An explicit mapping to a generic visual block
is still resolved knowledge and should not emit an unresolved-symbol warning.
