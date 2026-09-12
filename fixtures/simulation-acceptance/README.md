# Simulation acceptance Projects

The existing `hosted-*.json` acceptance manifests and `ota-5t*` inputs are
retained as service-level regression fixtures. They are not the human-importable
native Code examples below and are not silently replaced.

## Native Code Project examples

From the repository root, build workspace packages, then run:

```powershell
node scripts/build-native-simulation-examples.mjs
```

The output directory is `output/native-simulation-examples`. Import one of its
four `.icproj.json` files with File → Import in Preview, open Code, select an
experiment folder, and run. Each Project includes its Canvas circuits and
source files; no file from the author's Downloads directory is needed.

| Project            | Experiments | Electrical intent                                                                  |
| ------------------ | ----------- | ---------------------------------------------------------------------------------- |
| `01-rc-filters`    | 4           | Low/high-pass AC and step response; 10 kΩ, 10 nF, 1.59155 kHz cutoff               |
| `02-rlc-filter`    | 3           | AC plus transient at under/critical/over damping; 10 mH, 100 nF                    |
| `03-common-source` | 4           | SKY130 bias/device OP, DC transfer, AC, small/large-signal native loop             |
| `04-sky130-ota`    | 8           | Preserved user OTA, OP/DC, TT/FF/SS AC, open-loop transient, noise, unity feedback |

Inputs live in separate `netlists/native-*/` directories. The OTA source is a
canonicalized copy of the user-supplied Five-Transistor OTA Project, with its six-transistor
drawing (five core devices plus bias device) and model parameters preserved.
The closed-loop experiment binds the same DUT with an explicit text testbench;
the open-loop Canvas testbench is not misrepresented as a feedback schematic.

Experiments use source setup v4, config v2 and the pinned
`sky130-core-continuous-ngspice46-v1` environment. SPICE owns `.temp`, `.lib`,
`save`, `let`, `meas`, analyses and loops. There are no legacy managed outputs,
measurements or sweep settings. Models are the declared SKY130 dependency, not
illustrative substitutes. Temperature is 27 °C; OTA AC covers TT, FF and SS,
and the other MOS analyses use TT. This is representative coverage, not a claim
that every product feature, process corner or analog specification is tested.

## Live MCP acceptance

The runner opens isolated temporary Preview browser contexts, imports through
the GUI, obtains a fresh full-authority claim for each temporary Project, and
runs prepare/start/read batch and artifact export through stdio MCP. It does
not use a user's open browser Project, restart their MCP, publish a Project,
call simulation HTTP endpoints directly, or substitute mocked simulator data.

The currently published 0.7.0 bundle predates parts of the native result
contract. Use a genuinely recompiled current-source MCP (a fresh build-info
path avoids an old bundled `dist/main.js` masquerading as a source build):

```powershell
pnpm --filter @icm/mcp-server... build
pnpm exec tsc -p apps/mcp-server/tsconfig.json --tsBuildInfoFile output/native-mcp-rebuild.tsbuildinfo
node scripts/run-native-simulation-examples.mjs
node scripts/analyze-native-simulation-examples.mjs
```

The runner defaults to current source and records the Git revision and entry
digest. It does not install or release a new MCP. Optional argument 2 changes
the output directory and argument 3 selects one exact Project slug. For an
explicit published-bundle regression, set `ICM_EXAMPLE_MCP_SOURCE=0` and place
the manifest-verified release archive and extracted package under
`output/mcp-published-0.7.0/`; this is expected to expose the compatibility issue
until the release is updated.

`results/<project>/<folder>/` contains immutable rawfiles, logs, result JSON,
native measurements, CSV exports and evidence manifests with verified SHA-256
digests. Multi-group plot exports are ZIPs. `mcp-export.icproj.json` is a
round-trip export, not a container for run history. Run history is intentionally
separate from portable Projects: an importing user must run again to populate
Results. The analyzer checks finite captured values and native measurements,
RC/RLC theory, the common-source load line and small-signal model, and nominal
OTA bias/feedback behavior. Treat missing results or failed checks as incomplete
acceptance, even if a simulator process exited successfully.

The generator contract test checks importable structure, clean diagnostics,
source-only experiment configuration and preservation of the user's OTA DUT:

```powershell
pnpm test:local scripts/build-native-simulation-examples.test.mjs
```
