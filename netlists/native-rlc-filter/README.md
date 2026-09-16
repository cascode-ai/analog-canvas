# RLC damping starters: native VACASK

The three folders in `apps/editor/src/examples/simulation-rlc.icproj.json` keep
the same reviewed Canvas, component values, folder IDs and binding. The original
`circuit.spi` remains structural interchange. `rlc.sim` is their native source
template, with `alter instance("R1") r=...` set to 200, 632.455532 or 1000 ohm.
This native control command changes only this Run, not the Canvas value.

The generated `circuit.spice` binding contains native source despite its stable
filename. Each folder has editable copies of the template,
[shared starter report](../../scripts/lib/native-starter-report.py), and the
existing measurement/plot reporting helpers. No JSON analysis protocol or
ngspice runtime is added. RC and RLC copies are checked against one report source.

## Preserved experiment intent

- L=10 mH, C=100 nF; temperature 27 C; same Canvas 0–1 V pulse, 100 us delay,
  100 ns rise/fall, 2 ms width and 4 ms period.
- AC 100 Hz–1 MHz, 100 points/decade; transient 0–1 ms with 500 ns initial and
  maximum step. Native `tran_fbr=.025` resolves the short source ramp, as in RC.
- The complex `Gain=V(out)/V(in)` trace is used by common dB/phase views. With
  the preserved unit AC input, it equals the old V(out) gain. CSV retains its
  real/imaginary values rather than the legacy precomputed dB vector.
- `peak_gain_db`, `peak_output` and `final_value` remain measurements. Peaks
  are maxima of returned samples, not fitted continuous-time peak estimates;
  final voltage is sampled at 1 ms. Original arrays remain available.

`vacask-sky130-candidate` is an observed local candidate Profile request requiring
native resistor/capacitor/inductor modules, voltage sources and declared Python3.
It is not an already deployed/qualified hosted environment. Python uses only
its standard library plus the copied reporting helpers. See the
[native runtime instructions](../../containers/vacask/README.md).

## Acceptance

`containers/vacask/starter-journey.test.mjs` checks all three source
folders and, with explicit native environment paths, executes their actual
Canvas-bound inputs through Prepare/Start/Read, paged artifacts and CSV.

The frequency reference is `1/(1 - omega^2*L*C + j*omega*R*C)`. The transient
reference integrates the analytical RLC step response over the finite 100 ns
source ramp, covering under-, critically- and over-damped poles. The saved
critical resistance is rounded; its continuous critical limit avoids unstable
subtraction of nearly equal roots (about 5e-11 relative parameter difference).

Frozen bounds before execution: complex AC component error below 1e-7,
transient voltage error below 10 uV and inductor-current error below 100 nA
at every native sample. Reported peak/final measurements must agree with their
returned arrays. These ideal-passive checks do not qualify foundry MOS models,
corners, hostile-code isolation or cloud deployment.
