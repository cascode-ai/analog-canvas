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

Only the seven released exact SKY130 masters are mapped: the core and LVT
1.8 V NFET/PFET pairs, `res_high_po`, `cap_mim_m3_1`, and the fixed
`pnp_05v5_W0p68L0p68`. Both exact master name and ordered public interface must
match. No SKY130 family regular expression is an electrical authority.

The mapped instance keeps its external binding while borrowing native artwork.
Its authored reference remains in the native M/R/C/Q domain; SPICE derives the
X card. MOS exposes D/G/S/B electrically, resistor R0/R1 map to frozen pins
1/2 and B is property-only, MIM C0/C1 map to frozen pins 1/2, and the fixed PNP
maps C/B/E directly to the existing PNP symbol. An explicit external block
presentation overrides automatic artwork choice.

The hosted Profile qualifies those same seven exact names. The continuous
library does not expose `sky130_fd_pr__diode_pw2nd_05v5`, while the available
four-terminal `sky130_fd_pr__npn_05v5_W1p00L1p00` makes ngspice 46 discard
model parameters. Neither is advertised as qualified merely because a generic
Diode or NPN symbol can print a model-bearing SPICE card.

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
