# Common-source starters: native VACASK candidate

Four native templates correspond to the unchanged four experiment folders in
`apps/editor/src/examples/simulation-common-source.icproj.json`. Canvas still
owns the circuit: 1.8 V supply, 10 kohm load, 1 pF capacitor, NFET W=10/L=1/nf=1,
and a 0.7 V input offset. The original `circuit.spi` remains structural interchange.
Stable binding filenames such as `circuit.spice` contain native generated syntax
at execution; filename extensions are not a second simulator selection.

Only executable source, dependency/configuration and four missing Ground name
claims change. Those claims are the exact output of the existing File/Open
normalizer, which the GUI already applies. Direct CLI compilation now sees the
same circuit without changing geometry, wire connections or device parameters.

## Preserved experiments

- OP: the nine model outputs use `nativeDeviceOpAcquisitions()` selectors from
  the converter-checked model-symbol manifest. No guessed wrapper primitive or
  old ngspice `@m...` spelling is used.
- DC: VIN=0.3–1.2 V in 5 mV steps. Native VIN explicitly switches from sine to DC
  before sweeping its `dc` parameter; otherwise its sine offset governs bias.
- AC: 10 Hz–1 GHz, 80 points/decade, complex `V(out)/V(in)` and `gain_db_1khz`.
  The common chart offers dB/phase without losing real/imaginary data in CSV.
- TRAN: 10 kHz at both 10 mV and 200 mV amplitudes; 0–400 us, initial/max step
  0.2 us. A native sweep preserves the editable loop. The authored Python report
  splits the returned amplitude column into two explicit time records and
  reports `output_pp` twice over 200–400 us. Original multi-axis data is retained.
  This does not pretend the static parser can infer arbitrary outer sweeps.

`report.py` is an editable copy of the
[shared starter calculations](../../scripts/lib/native-starter-report.py).
`icm_reports.py` uses the existing measurement/plot reporting helpers. No hidden
frontend evaluator, new persisted analysis plan, or ngspice fallback is added.

## Environment and acceptance boundary

`vacask-sky130-tt-candidate` requests the converted TT dependency and exact digest
in [model-symbols-tt.json](../vacask-sky130/model-symbols-tt.json). Its Profile must
declare wrapper `defaultScale=1e-6`; Canvas dimensions and source do not inject a
second scale. It needs native BSIM4 4.8.3 with the reviewed chain-rule correction,
the native R/C/source modules, and a declared Python 3 standard library.
This Profile is **not a deployed or fully qualified hosted environment**.

`containers/vacask/starter-journey.test.mjs` verifies source/helper identity and,
with explicit local binary/module/model/Python paths, executes all four folders
through Prepare/Start/Read and paged File/CSV output. Checks include nine finite
OP outputs, OP/DC KCL below 1 nA, all 181 DC biases, all 641 AC gain samples, both
native transient groups without resampling/loss, the exact sine stimulus and
measurements recomputed from the returned arrays. RC/RLC analytical acceptance
is rerun because report code is shared.

These checks establish example and result fidelity, **not equivalence to the old
BSIM4 4.5/4.62 baseline**. Upgrading to 4.8.3 is user-authorized; coefficients are
not retuned. Strict cross-engine/corner/model qualification remains governed by
the [migration plan](../../docs/roadmap/vacask-migration.md), including unresolved
OTA AC/TRAN differences. Local execution does not establish cloud isolation,
resource acceptance or production readiness.
