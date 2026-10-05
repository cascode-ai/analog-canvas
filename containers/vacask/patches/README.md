# Native hard switches

`hard-switch.patch.json` stores the exact patch lines, including upstream trailing
spaces, without introducing whitespace lint exceptions. The build decodes it to
`hard-switch.patch` and applies it with ordinary strict `git apply`. It applies
only to upstream VACASK `_0.3.4`, revision
`c1a1c84f1b2b9aa71c0cddf06e555441434db7b7`. The build identifies itself as
`0.3.4-icm-hard-switch1`, not an unchanged upstream release. OpenVAF and OSDI
model bytes remain unchanged.

The original ternary behavioral source could not report voltage-threshold
events: its algebraic voltage jump failed transient LTE indefinitely at 1.5 ns.
OpenVAF in the accepted bundle does not implement `cross`, and its nonnegative
`$discontinuity` did not fix the reproduced deck. Smoothing would change the
electrical model, so it is not a fallback.

The patch adds a four-terminal `icm_switch` primitive sharing the controlled
source's existing MNA stamping. Its equation is exactly
`I(p,n) = $mfactor * V(p,n) / (V(cp,cn) > vt ? ron : roff)`. Positive finite
resistances and a finite threshold are required. No hysteresis, hidden RC,
minimum rise time or default tolerance is introduced.

Control voltage and time live in the simulator's accepted/rollback state
history. A crossed threshold requests an interpolated breakpoint and a retry;
an overshoot lets the existing cutter select the exact breakpoint rather than
repeatedly halving a step already ending there. At the accepted hard edge,
algebraic unknowns have no reducible truncation error; charge/flux equations
still undergo LTE control. Integration restarts at order one. Circuits without
this primitive keep their original path.

`Simulator host → vacask-compat-build` applies the patch to the pinned clean
source, builds, and runs the actual generated model family and hard-edge/RC
acceptance in `packages/netlist/src/model-contract-acceptance.test.ts`. It then
upgrades a staged copy of the accepted Production inputs using the existing
image packager, preserving models, compiler, Python, harness, limits and
capabilities. A strict read-only image boot must match the new environment lock.
This produces artifacts only; deployment is still the explicit host action and
editor changes still use the normal pull request / merge queue.

Local qualification used ngspice 46 and this patched native runtime: 56 cases,
including rising/falling edges of all four drawn switch variants, R and 100 pF
RC loads, default RON 1 Ω / ROFF 1e12 Ω / VT 0.5 V, and 35 ns transient runs at
`reltol=1e-6`, `vntol=1e-10`, `abstol=1e-15`. Every R sample matches the hard
state; each threshold has an accepted event point; every RC sample is within
50 µV of the independent piecewise exponential solution. Static switch OP/AC
and all existing generated model families remain covered. This is bounded
qualification, not a claim about arbitrary feedback-controlled switches or
general Verilog-A event support. Licensed Spectre remains a separate obligation.

Upstream is AGPL-3.0. Build artifacts include the complete upstream source
archive (including its license), this patch and the exact revision; the image
retains them under `/opt/model-source/vacask/`. Corresponding source and the
rebuild recipe must remain publicly available when this runtime is hosted.
