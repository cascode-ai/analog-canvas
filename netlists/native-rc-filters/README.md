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

The requested `vacask-sky130-candidate` Profile needs native resistor/capacitor OSDI,
voltage sources and a declared Python 3 runtime. This candidate name is not a
qualified hosted Profile; a Worker configuration that sets `VACASK_PROFILE_ID`
routes it to the separate VACASK gateway. There is no ngspice fallback or
automatic Profile swap.
The report uses only Python's standard library and the copied report helpers.

- Temperature 27 C; R=10 kohm, C=10 nF; AC 10 Hz–1 MHz, 80 points/decade.
- Step source remains the Canvas pulse: delay 100 us, rise/fall 100 ns,
  width 2 ms, period 4 ms, 0–1 V. Stop remains 1 ms, initial step 1 us.
- Maximum integration step remains 1 us. Native `tran_fbr=0.025` resolves the
  short source ramp after a breakpoint; it is a solver setting, not a relaxed
  tolerance.
- Native complex `Gain=V(out)/V(in)` replaces old separately computed `gain_db`
  and `phase_deg` raw columns. The GUI no longer plots results; CSV retains
  real/imaginary transfer data for external dB and phase views. `gain_at_fc`
  remains a dB scalar, linearly interpolated at 1591.549431 Hz from the sampled
  dB response.
- `at_one_tau` and `final_value` remain voltage scalars at 200.05 us and 1 ms.
  Measurements interpolate actual returned samples; no out-of-range clamping.

## Acceptance

`containers/vacask/starter-journey.test.mjs` checks all four bundled
source folders against these recipes and the native compiler.
No MOS, foundry corner, hosted isolation or production qualification is claimed.

The example export command reads these bundled Projects; see the
[export instructions](../../apps/editor/src/examples/SIMULATION.md).
