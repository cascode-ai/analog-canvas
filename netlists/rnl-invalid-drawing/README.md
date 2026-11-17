# RNL drawings with a wire on the wrong net

`reset-chain.scs` binds each flip-flop's reset pin to terminal 3 of its call
and draws one wire on `RESET` between them, but terminal 3 of each call is
its D input (`D1`, `D2`), not `RESET`. RNL connects nothing by position, so the
wire would join two nets the netlist keeps apart; RNL reports it
(`RNL4204 wire-net-mismatch`). The import keeps the circuit and the drawing,
leaves that wire out and reports `RNL_IMPORT_WIRE_WRONG_NET`
(`apps/editor/src/features/netlist-export/rnl-import-safety.test.ts`).
