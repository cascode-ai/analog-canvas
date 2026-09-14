# Native VACASK resistor noise fixture

[noise.sim](noise.sim) measures a 1 kohm resistor at 300 K. Its unloaded output
has unity input/output gain and voltage-noise PSD `4*k*T*R`.
[resistor_noise.raw](resistor_noise.raw) is unedited VACASK output and explicitly
contains power density, not amplitude density. Reproduce it with the
[shared analytical qualification command and criteria](../vacask-divider/README.md).

This is not a foundry-device or hosted-runtime qualification.

[current-reference.sim](current-reference.sim) uses a current input and the
same resistor to ground. [current_noise.raw](current_noise.raw) was captured
unchanged from the pinned Windows VACASK 0.3.4 binary with controlled startup.
Its squared transfer is `R² = 1e6 V²/A²`, so input-referred ASD is
`sqrt(4*k*T/R)` in A/sqrt(Hz), not V/sqrt(Hz).

The result adapter retains native PSD/transfer/contribution vectors and exposes
ASD curves through the common noise result. Its RMS integrals are explicitly
labelled **sampled PSD**: trapezoidal integration of PSD over the recorded
frequency band, followed by a square root. This is an estimate, not a native
VACASK scalar and not an exact integral for arbitrary spectra. No extrapolation,
sorting or bridging missing samples is performed. Undefined input referral stays
null; a missing integral is absent, never zero.
