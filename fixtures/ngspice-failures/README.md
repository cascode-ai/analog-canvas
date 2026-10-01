# ngspice failure captures

Five decks that ngspice 46 fails on, each beside what it printed
(`<name>.log`, stdout and stderr together) and, where it wrote one, its
rawfile. Captured on 2026-10-01 with the Homebrew ngspice-46 build by running
`ngspice -b <name>.deck.spi > <name>.log 2>&1` from this directory. Every run
exits 1.

They pin how `packages/spice-run/src/verdict.ts` reads a failed run (#1261):
the cause is kept and comes first, ngspice's follow-on lines do not stand in
for it, and the exit status is not explained away when the results are
missing or cut short.

| deck                  | what goes wrong                              | what ngspice prints                                                                                                         |
| --------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `wrong-port-count`    | a six-port `.subckt` called with five nodes  | `Too few parameters for subcircuit type "scint"`, with no `Error:` prefix and no line number                                |
| `unknown-subckt`      | a call to a subcircuit nobody defined        | `Error: unknown subckt: …`, then `in line no. 3 from file unknown-subckt.deck.spi` on a line of its own                     |
| `parallel-sources`    | two ideal voltage sources across one node    | the same singular-matrix warning six times; every convergence aid then fails and the operating point is abandoned           |
| `failed-op-constants` | the same circuit, with `setplot const` first | the same log, and a rawfile that holds only ngspice's built-in constants                                                    |
| `aborted-transient`   | a current growing as `exp(100·V)` into 1 pF  | `doAnalyses: TRAN:  Timestep too small` at 9.78 ps and `tran simulation(s) aborted`; the rawfile keeps the 73 points before |

Every one of them also ends with ngspice's batch epilogue,
`Error: incomplete or empty netlist … no simulations run!`, although each
netlist is complete.

`failed-op-constants` stands in for a hosted run on 2026-09-30 whose rawfile
held only the constants plot after its operating point failed. Here a plain
`write` after that failure writes nothing (`no writable vector found`), so the
deck selects the constants plot itself.

The logs and rawfiles keep ngspice's trailing spaces and blank lines;
`.gitattributes` marks them as verbatim evidence.
