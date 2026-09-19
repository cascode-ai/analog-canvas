# Hierarchical parameter acceptance

This is an ideal linear-resistor fixture, not a foundry-model benchmark.
`fixture.ts` constructs the same typed Project consumed by the editor. Each
Resistors Cell contains `R1={Rbase}` and `R2={2*Rbase}` in series; its ordered
interface is IN, OUT. The top has two independent callers and ports A, B, G.

After `pnpm build`, run with Node 24 and an existing ngspice installation:

```text
node netlists/hierarchy-parameters/verify.mjs /path/to/ngspice
```

On Windows, an executable in WSL Ubuntu can be used by appending `--wsl`.
The script does not install software or modify the machine. It passes the
exported Project deck to ngspice through stdin and fails on missing output,
failed execution or an absolute current error of 1e-10 A or more.

The wrapper drives each Cell with 1 V and runs OP. Current is negative because
it is measured into each supplying voltage source:

| State                      | X1 current | X2 current |
| -------------------------- | ---------: | ---------: |
| Default 1k, X1 override 2k |  −1/6000 A |  −1/3000 A |
| Rename Rbase → Resistance  |  unchanged |  unchanged |
| Change default to 3k       |  −1/6000 A |  −1/9000 A |
| Clear X1 override          |  −1/9000 A |  −1/9000 A |

Validated locally with Ubuntu ngspice 42 (`42+ds-3build1`). No model library,
process corner or temperature-dependent device is involved. This proves the
parameter scope and exported electrical behavior for this fixture, not general
analog performance, native dialect coverage or the hosted engine environment.
The matching unit contract is `packages/netlist/src/hierarchy-parameters.test.ts`.
