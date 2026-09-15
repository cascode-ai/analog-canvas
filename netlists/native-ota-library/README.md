# Native Library OTA lab

The browser Library asset is
[`five-transistor-ota-sky130.icproj.json`](../../apps/editor/src/examples/five-transistor-ota-sky130.icproj.json).
It contains twelve **authored native VACASK** folders, not structured settings
silently compiled to a second language. Its three Canvas Cells, DUT port order,
six MOS sizes/finger counts, source values and PULSE/SIN waveforms are unchanged.

`legacy-source.icproj.json` is the exact previous schema-48 Library input. It is
retained only for historical import/projection/acceptance tests; it is not the
browser Library asset or an executable fallback. Its complete experiment matrix
is also the test oracle for this explicitly reviewed conversion. The older
`netlists/native-ota/source.icproj.json` is a different historical circuit export
and cannot replace this twelve-experiment fixture.

| Folder suffix | Original analysis coverage retained |
| --- | --- |
| `op-ac` | OP; DC 0.88–0.92 V / 5 mV; AC 1 Hz–1 GHz / 10 per decade; TRAN 4 us / 20 ns |
| `full-tt` | OP; DC 0.86–0.94 V / 1 mV; AC and Noise 1 Hz–1 GHz / 40 per decade; TRAN 6 us / 10 ns |
| `bias-tt` | OP including M1/M3 native device parameters and supply-current measurement |
| `dc-transfer-tt` | DC 0.86–0.94 V / 1 mV, minimum/maximum/peak-to-peak/value at balance |
| `ac-{tt,ff,ss,fs,sf}` | Five distinct model artifacts; 1 Hz–1 GHz / 40 per decade |
| `tran-tt` | Canvas PULSE, 6 us / 10 ns; measurement window 1–6 us |
| `noise-tt` | 1 Hz–1 GHz / 40 per decade; input/output density at 1 kHz |
| `tran-sin-tt` | Canvas SIN, 5 us / 5 ns; measurement window 1–5 us |

Native TRAN uses the old step as the maximum adaptive step as well as the initial
step; it does not promise the same sample grid as ngspice. Combined programs
restore `VINP` to its Canvas pulse/DC value after the DC sweep. Model scale stays
Profile-owned. Each corner requests `vacask-sky130-<corner>-candidate` with the
actual converted model digest; a missing Profile remains a repairable environment
error, not a reason to use TT or the previous simulator.

M1/M3 parameters are saved only for OP. The full experiment uses `clear saves`
and explicitly reselects its waveform signals before DC/AC/TRAN/Noise, so device
parameter arrays do not unintentionally multiply retained data. Session artifact
and executor output caps are unchanged; a simulation exit code alone is not
enough when evidence collection reports an error.
The standalone folders save their original requested signals: the four-analysis
folder keeps its four voltages, transfer keeps three, and AC/PULSE/SIN keep input
and output. They do not inherit the full lab's six-signal recording set.

`report.py` is editable source copied into each folder. It imports the shared
native ASCII reader/interpolator from `native_report.py` (the import-safe
[`native-starter-report.py`](../../scripts/lib/native-starter-report.py)). The
ICM helpers only frame explicit plots/scalars. Complex voltage gain provides
the normal magnitude/dB/phase views, and positive supply current is an explicit
derived signal; original native raw records remain downloadable. The original
scalar names are retained. Mean and RMS use time-weighted trapezoids with linear
interpolation at window endpoints, not an arithmetic average of adaptive samples.
Noise density takes the square root of native PSD; the native integral is labelled
`trapezoidal-psd`, not falsely equated to historical ngspice per-source integration.

## Validation boundary

`containers/vacask/starter-journey.test.mjs` checks exact circuit preservation,
source/report identity, wrapper-selected device parameters, all twelve public
Prepare/Run/Read flows, measurements independently recomputed from returned
arrays, analysis ranges, original waveforms, and downloadable CSVs. Runtime
checks require the explicit VACASK/Python/model variables documented in the
adjacent starter READMEs, with `ICM_VACASK_CONVERTED_FS` and
`ICM_VACASK_CONVERTED_SF` in addition to TT/FF/SS.

Local execution with VACASK 0.3.4, corrected BSIM4 4.8.3 and Python 3.12 passes
all sixteen source/runtime tests, exercising 31 folders (19 starters plus these
12). The eight TT Library folders complete in one session with all evidence
retained under unchanged caps. This verifies source/result fidelity; it is not
the cross-simulator numerical qualification below.

This is a BSIM4 **4.8.3 candidate upgrade**, not equality to historical 4.5/4.62
results or a declaration that the model environment is qualified. The separate
fixed-reference model qualification, isolated cloud acceptance and full GUI/MCP
journey remain required by the migration roadmap. No shared Preview or Production
runtime is changed by importing this Library Project.
