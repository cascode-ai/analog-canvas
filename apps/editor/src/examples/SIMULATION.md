# Simulation starters

The four `simulation-*.icproj.json` files are complete source-Code Projects,
exposed only in the Simulation start area. They are not Gallery registrations.
They were imported from the four user-reviewed Downloads exports on 2026-09-13;
schematics, parameters and executable source were preserved. Only teaching
comments were added. Run history is not part of these assets.

The import boundary parses an isolated copy and applies the same conductor and
legacy Ground-marker normalization as File/Open. It assigns a new Project id,
asks about whole-Project replacement, then uses the normal unsaved-work guard.
Cancelling either prompt must leave the original Project installed. Never infer
that a Project is empty from its currently visible Cell.

The starter programs cover 4 RC, 3 RLC, 4 common-source and 8 OTA experiments.
On the VACASK migration branch, four RC, three RLC and four common-source
experiments are translated to native VACASK; see
[RC acceptance](../../../../netlists/native-rc-filters/README.md),
[RLC acceptance](../../../../netlists/native-rlc-filter/README.md) and
[common-source acceptance](../../../../netlists/native-common-source/README.md).
Their Canvas data is preserved; only executable source, report files and requested
Profile change. AC exposes a complex Gain trace with common dB/phase views.
The OTA recipes still contain legacy ngspice programs and
are not yet runnable through the native compiler. Tests intentionally continue
to reject those unfinished conversions; a Code-only config does not establish
that its executable source is native. Historical numerical
acceptance lives in the local `output/native-simulation-examples` evidence, not
inside the bundled Project. Adding comments does not establish a new electrical
qualification; no solver or model values were changed in this import.

The subsequent common-source conversion requests an explicit BSIM4 4.8.3 TT
candidate; this is a model-version upgrade requiring separate qualification,
not a declaration of equality to the original ngspice model. Four missing GND
claims were materialized with the existing File/Open normalization so direct
compilation has the same electrical input as the GUI. Geometry is unchanged.

OTA experiment 08 intentionally uses Canvas only for the `ota_5t` subcircuit.
Its sources, load and feedback are in `testbench.spice`; the visible open-loop
Canvas Testbench is not part of that experiment. This is a supported mixed
workflow, not a requirement to draw a second Testbench.

New experiment comments are created once, then owned by the user. Source context
uses the live draft include graph and calls subcircuit references “sources”, not
proof of instantiation. Dynamic source loading or broken includes are marked for
Prepare verification. Code parameter overrides do not rewrite Canvas values.

## Export reviewed examples

After building the Agent adapter/exporter dependencies, use a fresh or empty
output directory:

```sh
pnpm --filter @icm/agent-adapter... --filter @icm/exporters... build
node scripts/build-native-simulation-examples.mjs output/passive-candidate --project rc --project rlc
```

This exports the bundled Projects without reconstructing their schematics or
maintaining a duplicate set of programs. It writes SVG/PNG/inspection artifacts,
authored files under `source/`, and actual native compiled files under `prepared/`.
Existing evidence is never overwritten. `manifest.json` is written last with
`compiled-not-executed`; Profile identity belongs to each folder. Compilation
does not run or qualify an environment, and no cloud endpoint is contacted.

Omitting `--project` selects all four Projects and all 19 folders. Every selected
folder must compile before any output is written: unfinished model-backed
conversions remain explicit failures, not silently skipped entries. The full
library test remains an acceptance obligation alongside the focused passive
export test. The former optional external OTA input is retired; the reviewed
bundled OTA is the single source, as for the other examples. This command does
not authorize using the older fixed-Preview remote runner for VACASK acceptance.
