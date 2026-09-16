# One native runtime, five model sections

This integration fixture exercises one VACASK Profile with a single sectioned
SKY130 model dependency. It is not a second engine, a per-corner process router,
or a comparison to ngspice results. The native source remains unchanged when
Prepare projects a requested corner into its existing `include ... section=`.

Build shared packages, then package a completed five-corner conversion:

```sh
pnpm --filter @icm/simulation-service... build
node scripts/package-vacask-model-library.mjs --conversion /absolute/candidate/conversion.json --output /absolute/fresh-package --dependency-id sky130-native-sections --master sky130_fd_pr__nfet_01v8 --master sky130_fd_pr__pfet_01v8 --master sky130_fd_pr__nfet_01v8_lvt --master sky130_fd_pr__pfet_01v8_lvt --master sky130_fd_pr__res_high_po --master sky130_fd_pr__cap_mim_m3_1 --master sky130_fd_pr__pnp_05v5_w0p68l0p68
```

The package adds only `section`/`endsection` boundaries around the exact five
converted files. It verifies every input against the conversion manifest, retains
coefficient and license text byte-for-byte, stays within the existing 16 MiB model
inspection limit, and derives each section's symbols through the existing inspector.
The output directory must not exist. `package-manifest.json` is written last;
a failed inspection can leave a partial directory without that success record.
Do not reuse or promote a partial attempt. A packaged artifact is not an executed
or deployed environment, and unresolved master names remain explicit.

The manifest's `dependency` and `modelSymbols` populate those same existing fields
of one capability Profile. Set that Profile's `corners` to `sections` and its
`modelLibrary` to the dependency ID, `defaultSection: tt`, `defaultScale: 1e-6`.
Supply the exact package path in the existing runtime dependency registry; do not
copy the 10 MB library into every Project or grow the user-input limit.

Run `containers/vacask/sectioned-library-journey.test.mjs` with `VACASK_BIN`,
`VACASK_MODULES`, and `ICM_VACASK_SECTIONED_MANIFEST` pointing to the real package.
`ICM_VACASK_LIBRARY_PATH` supports the selected Linux binary's loader assets.
Optional `ICM_VACASK_EVIDENCE_DIR` retains a fresh `sectioned-profile-*/runs.json`,
including input and output for unsuccessful runs. Missing runtime inputs skip
the test and are not acceptance. The test uses the real HTTP entrypoint and shared
Prepare, no simulated executor responses.

The circuit uses core/LVT NFET and PFET, a high-poly resistor, a MIM capacitor,
the fixed PNP, and native sources/load resistance at 1.8 V and 27 °C. The PNP
name uses the converted artifact's lowercase spelling, not the original
case-insensitive SPICE alias. It requests OP, a five-point
input DC sweep, complex AC, a 1 µs pulse transient and output/input noise. Every
corner must return complete finite native records and exact executed input under
the same measured runtime identity. Unknown corners are rejected without changing
the original folder. This does not assert foundry accuracy, a device's full legal
geometry domain, Canvas mapping for every wrapper, GUI/MCP completion or hosted isolation.

Bundled Projects were rebound separately to one `vacask-sky130-candidate`
Profile and the `sky130-native-sections` dependency; this proof alone does not
rebind saved sources, rewrite historical results, register a hosted Profile or
deploy the library.
