# Native hard switches

`hard-switch.patch.json` stores the exact patch lines, including upstream trailing
spaces, without introducing whitespace lint exceptions. The build decodes it to
`hard-switch.patch` and applies it with ordinary strict `git apply`. It applies
only to upstream VACASK `_0.3.4`, revision
`c1a1c84f1b2b9aa71c0cddf06e555441434db7b7`. The build identifies itself as
`0.3.4-icm-hard-switch2`, not an unchanged upstream release. OpenVAF and OSDI
model bytes remain unchanged.

The original ternary behavioral source could not report voltage-threshold
events: its algebraic voltage jump failed transient LTE indefinitely at 1.5 ns.
OpenVAF in the accepted bundle does not implement `cross`, and its nonnegative
`$discontinuity` did not fix the reproduced deck. Smoothing would change the
electrical model, so it is not a fallback.

The patch adds a distinct four-terminal `icm_switch` primitive using the
controlled source's MNA stamp pattern, not its parameter type. Ordinary VCCS
and VCVS retain the upstream parameter contract and reject `ron`, `roff`, and
`vt`. The switch equation is exactly
`I(p,n) = $mfactor * V(p,n) / (V(cp,cn) > vt ? ron : roff)`. Positive finite
resistances and a finite threshold are required. No hysteresis, hidden RC,
minimum rise time or default tolerance is introduced.

Control voltage and time live in the simulator's accepted/rollback state
history. A crossed threshold requests an interpolated breakpoint and a retry;
an overshoot lets the existing cutter select the exact breakpoint rather than
repeatedly halving a step already ending there. At a localized hard edge,
two auxiliary solves evaluate the old and new switch topologies at the same
time and predicted independent reactive potentials. Their algebraic difference
corrects the polynomial predictor's instantaneous topology jump. **Every unknown
still undergoes LTE control**; reactive unknowns receive no jump correction.
Unrelated smooth branches and nonlinear outputs of capacitor states retain
their ordinary predictor error. Ideal voltage-constrained reactive potentials
remain algebraic constraints rather than acquiring redundant identity rows.
The projections neither advance accepted history nor become output points;
failure rejects the candidate step. The actual solve is restored and refreshed,
including device outputs, Jacobian, tolerance maxima and breakpoint requests.
Noise contributions and filtered solutions are derived only after restoration;
projection scratch cannot replace the solved noise contribution in the LTE floor.
Integration restarts at order one. Circuits without this primitive keep their
original path. No tolerance, integration coefficient or switch law is changed.

The previous `hard-switch1` patch skipped LTE for every equation without a
direct reactive stamp. The real CLI regressions reproduce that bypass on both
a time-driven smooth output and a nonlinear output of a voltage-driven
capacitor. `hard-switch2` removes that exemption and additionally checks an
independent RC-state nonlinear output against its ramp-response solution.
These are bounded independent-state and voltage-constrained-capacitor checks,
not a qualification of arbitrary floating-state DAEs, feedback controls, or
simultaneous event systems. The
separate initial-closed strict RC and smooth-NAND convergence investigations
in [#1359](https://github.com/cascode-ai/analog-canvas/issues/1359) remain open.

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

The **previous hard-switch1** formal Linux build and strict pinned-image boot passed in
[run 37294456075](https://github.com/cascode-ai/analog-canvas/actions/runs/37294456075):
51 native cases passed (the five ngspice cases are qualified locally, not claimed
as run on this Linux job). Models and startup retain their previous accepted
identities. The previous build image is
`sha256:e2bbd5d23b1595d5acea5d1f6461616afc8a04bd1bca54dbe8f3ab1267d60552`;
the host must independently verify its own image and runtime lock.

Local `hard-switch2` qualification runs the real Linux CLI: 64 native cases
cover the existing generated families and R/RC switch cases plus six parameter
rejections, two unchanged controlled-source gain checks, four dynamic LTE
isolation cases, and a fixed-seed SDE-noise restoration regression. The latter
checks the public edge LTE ratio against the independent passive-resistor noise
contribution, retaining the default 3.5 LTE ratio and noise floor. Each smooth
isolation case also runs its matching no-switch control
against the independent reference. The RC-state ramp uses a 1 ps maximum step
to resolve its startup; the other three isolation cases use 100 ps. These are
explicit testbench settings, not changes to runtime defaults. Every saved
RC-state sample stays within the existing 50 µV analytical bound, and ordinary
nonlinear-output residuals are checked at the configured 1e-6 NR tolerance.
The six leakage probes and the LTE-isolation probes fail against the
previous accepted binary. The registered patch also passes strict application
to the clean pinned upstream index. Local CLI qualification does **not** replace
the required formal build, read-only candidate-image boot, or hosted GUI/MCP
acceptance.

The `hard-switch2` formal Linux build and strict pinned-image boot passed in
[run 37628367690](https://github.com/cascode-ai/analog-canvas/actions/runs/37628367690)
at source commit `415894d95d99ff00544bb79b62d285488f1852a8`: **64 native cases
passed, five ngspice cases skipped**. The read-only, non-root, no-network image
boot measured the identity now recorded in `config/vacask-preview-environment.json`.
The image is `sha256:b3e291b28898fd7c8b254fc09c7f2b6a573097118c73c3f5344965664062d416`.
Only simulator version, binary and environment fingerprint changed; models,
startup, compiler, capabilities and limits are preserved. This lock declares the
qualified target, not proof that a host is running it. Deployment must measure
the same identity independently and complete hosted GUI/MCP acceptance.

Upstream is AGPL-3.0. Build artifacts include the complete upstream source
archive (including its license), this patch and the exact revision; the image
retains them under `/opt/model-source/vacask/`. Corresponding source and the
rebuild recipe must remain publicly available when this runtime is hosted.
They are published in the
[corresponding-source release](https://github.com/cascode-ai/analog-canvas/releases/tag/vacask-runtime-source-0.3.4-icm-hard-switch2).
