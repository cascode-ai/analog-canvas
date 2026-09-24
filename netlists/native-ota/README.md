# Native OTA starter programs

The eight folders in `apps/editor/src/examples/simulation-ota.icproj.json` retain
the reviewed two-cell Canvas, all device/source values, folder IDs and bindings.
The six physical MOS instances include the bias mirror. No width, length, NF,
load, source or feedback topology was simplified to obtain a passing run.
These templates are copied into editable source files in each folder; the
generated `circuit.spice` binding is native VACASK despite its stable filename.

| Folder | Native program / preserved behavior |
| --- | --- |
| 01 Bias | Six model occurrences × nine native OP outputs; four node voltages and supply current |
| 02 DC | VINP 0.86–0.94 V, 1 mV steps; explicitly switch pulse source to DC |
| 03–05 AC | Distinct TT/FF/SS model sections, 1 Hz–1 GHz, 60 points/decade; DC gain and first falling unity crossing |
| 06 pulse | Original Canvas 0.9→0.91 V pulse, delay 1 us, 1 ns edges, 1 us width, 3 us period; 6 us run at ≤2 ns step; output extrema |
| 07 Noise | TT native noise, 1 Hz–1 GHz, 30 points/decade; input/output density and explicitly labelled sampled-PSD integral |
| 08 feedback | Canvas emits only the `ota_5t` subcircuit; native text TB owns sources, unity feedback and load; AC plus ≤1 ns-step 6 us transient |

The text TB preserves port order `vdd vss ibias vinn vinp vout`. Its pulse is
intentionally different from the visible open-loop TB: width 2 us, period 5 us.
Do not substitute the Canvas top-level circuit into this folder. Its measurements
remain low-frequency gain, output at 2 us and output peak over 1–3 us.

The Canvas bias Net is unnamed, so it exports as the ordinal `net0`, not
`ibias`. The OP source uses that real IR name; it does not invent a new Net or
change the drawing. `simulation-examples.test.ts` fails if a saved node stops
existing in the compiled circuit.
Native model `vgs/vds/id` retain their **intrinsic model** meanings, not falsely
labelled terminal voltages/currents. Native helper selectors are checked against
the converter-derived primitive inventory.

## Shared calculations and environment

`report.py` is copied from [the shared starter report](../../scripts/lib/native-starter-report.py).
It computes complex gain from returned voltages and reports through the existing
Python framing helpers. Gain-at-frequency and falling crossing use linear
interpolation of sampled dB against frequency. Missing crossings report an
unavailable measurement; they do not erase the waveform. No frontend evaluator
or parallel JSON analysis configuration is introduced.

Each bundled model folder requests `vacask-sky130-candidate`, with the native
include selecting its original `section=tt`, `ff`, or `ss`. The single dependency
digest and section-specific primitive maps are in
`netlists/vacask-sky130/model-symbols-sections.json`, derived by
`inspectVacaskModelArtifact()` from the packaged converted files.
The Profile owns `defaultSection=tt`, the `defaultScale=1e-6` wrapper policy, and requires
the reviewed BSIM4 4.8.3 native module and declared Python runtime. These are
candidate identities, **not qualified hosted Profiles**; among the committed
Worker configurations, only Preview routes the Profile to the isolated
VACASK executor.

## Acceptance boundary

`containers/vacask/starter-journey.test.mjs` compiles all eight folders and uses
the public Prepare/Start/Read and paged File resources for actual native runs.
Set `VACASK_BIN`, `VACASK_MODULES`, `ICM_PYTHON`, `ICM_PYTHON_LIBRARIES`, and the
explicit `ICM_VACASK_SECTIONED_MANIFEST` package-manifest path. Optional
`ICM_VACASK_EVIDENCE_DIR` preserves fresh per-folder public artifacts and executed
inputs, rather than replacing previous observations.

Checks cover all 54 OP outputs, 81 DC inputs, 541 AC points in each corner,
271 noise points, both distinct pulse stimuli, authored measurements recomputed
from arrays, and CSV availability. All 19 starter programs are exercised because
the report is shared. This is native source/result fidelity, as required by the
[migration plan](../../docs/roadmap/vacask-migration.md), not cross-engine equivalence.

BSIM4 4.8.3 is a user-approved model-version upgrade. Native noise integration
is labelled `trapezoidal-psd`, not passed off as ngspice's per-source integral.
Existing strict OTA AC/TRAN discrepancies, five-corner/model qualification,
isolated-cloud resource/security checks and full public GUI/MCP acceptance
remain independent obligations. The older `source.icproj.json` in this directory
is not the canonical starter or an automatically executable native program.
