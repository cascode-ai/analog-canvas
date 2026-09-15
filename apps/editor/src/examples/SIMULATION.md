# Simulation starters

The four `simulation-*.icproj.json` files are complete source-Code Projects,
exposed only in the Simulation start area. They are not Gallery registrations.
They were imported from the four user-reviewed Downloads exports on 2026-09-13;
schematics, parameters and executable source were preserved. Only teaching
comments were added. Run history is not part of these assets.

The import boundary parses an isolated copy and applies the same conductor and
legacy Ground-marker normalization as File/Open. It assigns a new Project id,
asks about whole-Project replacement, then uses the normal unsaved-work guard.
Cancelling either prompt must leave the original Project installed. Never infer
that a Project is empty from its currently visible Cell.

The starter programs cover 4 RC, 3 RLC, 4 common-source and 8 OTA experiments.
On the VACASK migration branch, the four RC experiments are translated to native
VACASK; see their [recipes and acceptance](../../../../netlists/native-rc-filters/README.md).
Their Canvas data is preserved; only executable source, report files and requested
Profile change. AC exposes a complex Gain trace with common dB/phase views.
The RLC, common-source and OTA recipes still contain legacy ngspice programs and
are not yet runnable through the native compiler. Tests intentionally continue
to reject those unfinished conversions; a Code-only config does not establish
that its executable source is native. Historical numerical
acceptance lives in the local `output/native-simulation-examples` evidence, not
inside the bundled Project. Adding comments does not establish a new electrical
qualification; no solver or model values were changed in this import.

OTA experiment 08 intentionally uses Canvas only for the `ota_5t` subcircuit.
Its sources, load and feedback are in `testbench.spice`; the visible open-loop
Canvas Testbench is not part of that experiment. This is a supported mixed
workflow, not a requirement to draw a second Testbench.

New experiment comments are created once, then owned by the user. Source context
uses the live draft include graph and calls subcircuit references “sources”, not
proof of instantiation. Dynamic source loading or broken includes are marked for
Prepare verification. Code parameter overrides do not rewrite Canvas values.
