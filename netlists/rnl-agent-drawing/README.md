# RNL drawings as an Agent writes them

Files written the way an Agent writes RNL 0.4 for Analog Canvas, not the way
Analog Canvas exports it: they use the standard collection `rnl-std-all`
(its fill included), leave the wire paths to their mode and name nets with
net labels. The import reads what each file writes
(`apps/editor/src/features/netlist-export/rnl-agent-import.test.ts`):

- `ota5t-auto-wires.sp`: every part placed, every wire from pin to pin in the
  default `auto` mode. Each route follows the path RNL draws; the wires that
  run over another wire of their net, so that their branch shows no junction,
  are reported (`RNL_IMPORT_WIRES_OVERLAP`).
- `net-labels.sp`: a divider whose input and middle node are named by
  `$NET_LABEL`s, which come in as net labels with their wires.
- `wrong-net-wire.sp`: the OTA with one wire marked on `x` but drawn to the
  drain of M2, which is on `out` (`RNL4204 wire-net-mismatch`). That wire is
  left out and reported (`RNL_IMPORT_WIRE_WRONG_NET`); the rest is drawn.
- `pdk-inverter.sp`: an inverter of PDK subcircuit calls declared with
  `@DEVICE(…, terminals=…, type=…)`, VDD and VSS drawn as a supply and a
  ground, and a structure (`$COMMON_SOURCE`). Every Cell Pin is placed, none
  is added for the fill's port tags, and the structure is no mark.
- `pdk-inverter-crossing.sp`: the inverter with OUT taken out across IN. RNL's
  layout hint names the line (`RNL_IMPORT_LAYOUT_HINT`); the drawing is the
  file's.
