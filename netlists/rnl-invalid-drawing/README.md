# RNL drawings the import leaves out

`reset-chain.scs` draws one wire on `RESET` between terminal 3 of two
flip-flops, but terminal 3 of each call is its D input (`D1`, `D2`), not
`RESET`. RNL connects nothing by position, so the drawing joins two nets the
netlist keeps apart. The import keeps the circuit, leaves the drawing out and
reports `RNL_IMPORT_INVALID_DRAWING`
(`apps/editor/src/features/netlist-export/rnl-import-safety.test.ts`).
