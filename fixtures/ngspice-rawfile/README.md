# ngspice ASCII rawfile fixtures

Four rawfiles written by ngspice 46, each beside the deck that produced it.
They exist so a parser is tested against output a simulator actually wrote,
not against output someone believed it writes.

Regenerate any of them with `ngspice -b <name>.deck.spi` from this directory.

| file                    | plot               | flags       | vars           | points |
| ----------------------- | ------------------ | ----------- | -------------- | ------ |
| `divider-op.raw`        | Operating Point    | real        | 3              | 1      |
| `divider-op-listed.raw` | Operating Point    | real        | 4 (one echoed) | 1      |
| `rc-ac.raw`             | AC Analysis        | **complex** | 4              | 17     |
| `rc-tran.raw`           | Transient Analysis | real        | 4              | 79     |

## What each one is for

Every circuit here has a closed-form answer, so the assertions compare against
arithmetic rather than against a recorded number whose only authority is that
the parser once produced it.

**`divider-op`** — 1 V across two 1 kΩ resistors. `v(mid)` is 0.5 V exactly,
and the fixture holds `5.000000000000000e-01`. One plot, one point: the
smallest shape the format takes.

**`divider-op-listed`** — the same divider, but its deck names the vectors
to write (`write … v(in) v(mid) i(v1)`), which is how a compiled simulation
setup asks for exactly its probes. ngspice writes the plot's scale before the
listed vectors, and an operating-point plot's scale is its first vector, so
`v(in)` appears twice in `Variables:` with one value. The reader must report
the probe once; the fixture exists so that echo is tested against a file the
simulator wrote.

**`rc-ac`** — R = 1 kΩ, C = 1 µF, so H(f) = 1/(1 + jf/f_c) with
f_c = 1/(2π·RC) = 159.1549 Hz. Every one of the 17 points can be asserted
against that expression, not just a point near the corner. Measured agreement
across the sweep:

- magnitude, worst relative deviation: **6.5e-16**
- phase, worst deviation: **1.4e-14 degrees**

That is machine precision, so this file supports a tolerance near 1e-12. It is
also the only fixture with `Flags: complex`, where each value is
`real,imaginary`.

**`rc-tran`** — the same network's step response, τ = 1 ms, so
v_out(t) = 1 − e^(−t/τ). Worst relative deviation across the run is
**4.8e-4**, at the earliest points where the ideal value is still near zero
and the integrator has the least to work with; 1e-3 is a tolerance that holds
with margin. The timesteps are chosen by ngspice and range from 1e-11 to
8e-05 — a factor of eight million — so a parser that assumes a uniform grid
will read this file and be wrong about when everything happened.

## One thing the format does that the header does not announce

A point's values are one indexed line followed by one line per remaining
variable, and then **a blank line** before the next point. Splitting on a
fixed line stride works on some files and silently misreads others. Split on
the blank line, and check the recovered point count against `No. Points`.
