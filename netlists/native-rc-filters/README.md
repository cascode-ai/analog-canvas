# RC starter: native VACASK migration

`circuit.spi` remains structural SPICE interchange. `ac.sim`, `step.sim` and
[the shared starter report](../../scripts/lib/native-starter-report.py) are
the native executable recipe sources for the four bundled RC
experiments in `apps/editor/src/examples/simulation-rc.icproj.json`. They expect
the normal Canvas binding to generate `circuit.spice` as native VACASK source;
the filename does not select a language. They are not standalone flattened decks.

The Project contains an editable copy of each recipe plus `icm_reports.py`, made
from the existing netlist measurement/plot helpers. The test compares these
copies. No runtime translation or second experiment configuration is introduced.
Schematic layout, sources, R/C values, folder IDs and binding identities stay
unchanged. No Gallery data is modified.

## Environment and semantics

The requested `vacask-passives-v1` Profile needs native resistor/capacitor OSDI,
voltage sources and a declared Python 3 runtime. This is a local candidate name,
not an available or qualified hosted Profile. Select/configure an actual matching
native environment before Run; no ngspice fallback or automatic Profile swap.
The report uses only Python's standard library and the copied report helpers.

- Temperature 27 C; R=10 kohm, C=10 nF; AC 10 Hz–1 MHz, 80 points/decade.
- Step source remains the Canvas pulse: delay 100 us, rise/fall 100 ns,
  width 2 ms, period 4 ms, 0–1 V. Stop remains 1 ms, initial step 1 us.
- Maximum integration step remains 1 us. Native `tran_fbr=0.025` resolves the
  short source ramp after a breakpoint. The default breakpoint fraction yielded
  about 11.7 uV error; reducing only maxstep to 250 ns still gave 11.3 uV.
  This is a native solver-setting adjustment, not a relaxed acceptance tolerance.
- Native complex `Gain=V(out)/V(in)` replaces old separately computed `gain_db`
  and `phase_deg` raw columns. The common Plot UI supplies dB and phase views;
  CSV retains real/imaginary transfer data. `gain_at_fc` remains a dB scalar,
  linearly interpolated at 1591.549431 Hz from the sampled dB response.
- `at_one_tau` and `final_value` remain voltage scalars at 200.05 us and 1 ms.
  Measurements interpolate actual returned samples; no out-of-range clamping.

## Acceptance

`containers/vacask/starter-journey.test.mjs` always checks all four bundled
source folders against these recipes and the native compiler. With explicit
`VACASK_BIN`, `VACASK_MODULES`, `ICM_PYTHON`, `ICM_PYTHON_LIBRARIES` (and Linux
loader paths when required), it runs the exact Project through the public local
Simulation service, actual native process, paged File API and CSV export.

The numerical reference is the analytical first-order RC response, including
the finite 100 ns ramp. Complex AC component error must be below 1e-7; the
sampled cutoff dB interpolation error below 0.002 dB; the two step measurement
errors below 10 uV. The scalar interpolation limits are not model tolerances.
No MOS, foundry corner, hosted isolation or production qualification is claimed.

Use the existing native harness environment instructions in
[containers/vacask/README.md](../../containers/vacask/README.md). Retain a Vitest
JSON report to record the real environment/input metadata and measurements.
The example export command now reads these reviewed bundled Projects, rather
than rebuilding a separate circuit/program. See the
[export instructions](../../apps/editor/src/examples/SIMULATION.md).
