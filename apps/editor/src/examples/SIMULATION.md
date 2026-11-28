# Simulation starters

The four `simulation-*.icproj.json` files are complete source-Code Projects,
exposed only in the Simulation start area. They are not Gallery registrations.
Run history is not part of these assets.

The import boundary parses an isolated copy and applies the same conductor and
legacy Ground-marker normalization as File/Open. It assigns a new Project id,
asks about whole-Project replacement, then uses the normal unsaved-work guard.
Cancelling either prompt must leave the original Project installed. Never infer
that a Project is empty from its currently visible Cell.

The starter programs cover 4 RC, 3 RLC, 4 common-source and 8 OTA experiments.
All 19 starter experiments and the separate twelve-folder Library OTA lab
(`five-transistor-ota-sky130.icproj.json`) target ngspice (`sky130-core-continuous-ngspice46-v1`).
AC exposes a complex Gain trace; the workspace shows Specs and Console, and CSV
keeps real/imaginary data for external dB/phase views. The older pre-migration
Library OTA source is retained in `netlists/native-ota-library/legacy-source.icproj.json`
for import compatibility tests.

OTA experiment 08 intentionally uses Canvas only for the `ota_5t` subcircuit.
Its sources, load and feedback are in `testbench.spice`; the visible open-loop
Canvas Testbench is not part of that experiment. This is a supported mixed
workflow, not a requirement to draw a second Testbench.

New experiment comments are created once, then owned by the user. Source context
uses the live draft include graph and calls subcircuit references “sources”, not
proof of instantiation. Dynamic source loading or broken includes are marked for
Prepare verification. Code parameter overrides do not rewrite Canvas values.
