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
four `.icproj.json` files with File → Import in the migration build, open Code,
and select an experiment folder. Execution requires its declared native candidate
Profile; the shared ngspice Preview cannot run these Projects. Each includes its Canvas circuits and
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

Experiments use native VACASK source and config v2. RC/RLC declare
`vacask-passives-v1`; MOS experiments declare `vacask-sky130-<corner>-candidate`.
Native programs own temperature, model selection, saves, analyses and loops;
editable Python postprocessors report measurements and derived plots through the
existing result contract. These observed candidate Profiles are **not qualified
production environments**. Models are the declared, digest-addressed SKY130
dependency with the approved BSIM4 4.8.3 upgrade, not illustrative substitutes.
Temperature is 27 °C; OTA AC covers TT, FF and SS,
and the other MOS analyses use TT. This is representative coverage, not a claim
that every product feature, process corner or analog specification is tested.

## Native numerical checks and remaining live MCP migration

The historical runner `run-native-simulation-examples.mjs` has **not yet been
migrated**: it still targets shared Preview, pins MCP 0.7.0 and flattens artifact
paths. Do not use it to qualify VACASK or deploy VACASK to that shared executor.
The intended live acceptance opens isolated temporary candidate browser contexts, imports through
the GUI, obtains a fresh full-authority claim for each temporary Project, and
runs prepare/start/read batch and artifact export through stdio MCP. It does
not use a user's open browser Project, restart their MCP, publish a Project,
call simulation HTTP endpoints directly, or substitute mocked simulator data.

For current local native execution, `containers/vacask/starter-journey.test.mjs`
runs the actual Prepare/Run/Read/File service against a configured VACASK binary,
modules, Python and matching model artifacts. Set `ICM_VACASK_STARTER_SANITY=1`
when running the **whole** file to additionally check all 19 starters together:

```powershell
$env:ICM_VACASK_STARTER_SANITY = "1"
pnpm test:local containers/vacask/starter-journey.test.mjs
```

Missing runtime/model configuration cannot produce a passing aggregate. Optional
`ICM_VACASK_EVIDENCE_DIR` retains per-run result artifacts and a fresh
`starter-sanity-*/acceptance.json`. This is local service/numerical evidence, not
GUI/MCP, isolated-cloud acceptance or fixed-reference model qualification.

`scripts/lib/native-example-acceptance.mjs` supplies those same checks to the
offline `analyze-native-simulation-examples.mjs` command. The CLI additionally
requires complete live receipts, hashed nested `executed/` and `raw/` artifacts,
matching compiled input and exported plots. Its output is exclusive-create;
existing acceptance evidence is not overwritten. Until the live runner preserves
that contract, its old output must not be described as accepted native evidence.

`results/<project>/<folder>/` contains immutable rawfiles, logs, result JSON,
native measurements, CSV exports and evidence manifests with verified SHA-256
digests. Multi-group plot exports are ZIPs. `mcp-export.icproj.json` is a
round-trip export, not a container for run history. Run history is intentionally
separate from portable Projects: an importing user must run again to populate
Results. The analyzer checks complete finite native arrays and measurements,
RC/RLC theory, the common-source load line and small-signal model, and nominal
OTA bias/feedback behavior, complex phase unwrapping, small/large-signal harmonic
distortion, and integrated noise recomputed from the returned PSD. Noise integration
is explicitly `trapezoidal-psd`, not ngspice's per-source integration. Existing
electrical sanity tolerances are unchanged; they are not the stricter M2 numerical
qualification thresholds. Treat missing results or failed checks as incomplete
acceptance, even if a simulator process exited successfully.

The generator contract test checks importable structure, clean diagnostics,
source-only experiment configuration and preservation of the user's OTA DUT:

```powershell
pnpm test:local scripts/build-native-simulation-examples.test.mjs
```
