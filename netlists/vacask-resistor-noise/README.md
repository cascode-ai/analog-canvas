# Native VACASK resistor noise fixture

[noise.sim](noise.sim) measures a 1 kohm resistor at 300 K. Its unloaded output
has unity input/output gain and voltage-noise PSD `4*k*T*R`.
[resistor_noise.raw](resistor_noise.raw) is unedited VACASK output and explicitly
contains power density, not amplitude density. Reproduce it with the
[shared analytical qualification command and criteria](../vacask-divider/README.md).

This is not a foundry-device or hosted-runtime qualification.
