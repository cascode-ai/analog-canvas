# Canvas EDA Tools

The flat `eda/` directory owns Canvas export and orchestration. `aether.py`
contains PyAether operations; `virtuoso.py` reuses the existing Bridge manifest
importer, not another SKILL or SSH implementation. Hosts, credentials, libraries,
and PDK installation paths are external configuration.

## Entry Points

- `snapshot.mjs`: export an existing public-gallery JSON snapshot through real Canvas code.
- `select_circuits.py`: optional HES eligibility and component-count selection, not import.
- `export.py`: prepare selected circuits offline for an explicit target.
- `import_one.py`: import and read back exactly one circuit.
- `import_batch.py`: call that same operation serially, retain progress, stop on failure.
- `capture.py` and `report.py`: Aether full-interface screenshots and comparison reports.

Geometry, PDK parameters, ports, and native readback have named modules.
`common.py` holds small JSON, number, and manifest helpers. CLI options are in
`--help`; there is no `eda/README.md`. The selector is HES-specific; its result
is a list of `[galleryId, cellName]` pairs, not proof of Virtuoso compatibility.

## Offline Export

Use Linux, a Canvas checkout, and a Node runtime containing esbuild and Canvas
dependencies. No EDA session is contacted.

```sh
python eda/export.py --help
python eda/export.py \
  --canvas-source /work/Analog-Canvas --runtime /work/node-runtime \
  --snapshot /work/gallery-snapshot --circuit gallery-id:ota \
  --backend aether --library canvas_demo --output /work/ota-bundle
```

Use `--selection /work/selection.json` instead of `--circuit` for many circuits.
Aether retains HES mapping, source topology, native PDK labels and default 1.5
spacing. `--expand-inverters` explicitly expands supported inverter primitives.
`--minimum-dimensions` explicitly adjusts out-of-range MOS dimensions to HES
minima and records changes; this does not establish electrical equivalence.

The bundle contains original projects/netlists, `aether_hes_import_spec.json`,
preflight results and standalone import scripts. Keep it outside the new native
library directory.

For Virtuoso, install `virtuoso-bridge-lite` with
`virtuoso_bridge.virtuoso.schematic.manifest` in the Python environment:

```sh
python eda/export.py \
  --canvas-source /work/Analog-Canvas --runtime /work/node-runtime \
  --snapshot /work/gallery-snapshot --selection /work/selection.json \
  --backend virtuoso --process-map /work/process-map.json --process target_pdk \
  --output /work/virtuoso-bundle
```

Outputs include target-independent `source.json` and Bridge-compatible
`schematic.json`. The process map supplies native masters, pin offsets and
parameter mappings. HES size/spacing policies are not applied. Internal supply
markers and expanded inverter endpoints are rejected because Bridge cannot yet
preserve that geometry unambiguously. Inverter expansion remains supported for
Aether. Unmapped parameters and process-map resizing overrides are rejected;
nothing is silently dropped.

## Native Import

Aether runs in an existing PyAether Python Console. Transfer the bundle to the
chosen server/session first; these tools do not create sessions or choose hosts.
Before running, confirm in Design Manager that the new library name is not
already registered elsewhere. The local path check cannot establish that.
Use only one import/GUI operation at a time in a session; output markers are not
session-wide locks.

```python
import runpy
runpy.run_path('/work/ota-bundle/import_one.py', run_name='__main__',
    init_globals={'EDA_ARGS': [
        '--backend', 'aether',
        '--input', '/work/ota-bundle/aether_hes_import_spec.json',
        '--cell', 'ota',
        '--library-parent', '/work/native-libraries',
        '--output', '/work/ota-bundle',
    ]})
```

For a batch, use `import_batch.py` and omit `--cell`. An existing target library
is refused. A bundle directory may contain export artifacts but must not contain
an earlier `import-attempt.json`. Use a new library for a separate attempt.

Virtuoso uses separately configured Bridge connections and an optional profile:

```sh
python eda/import_one.py --backend virtuoso \
  --input /work/virtuoso-bundle/schematic.json --cell ota \
  --process-map /work/process-map.json --process target_pdk \
  --env /secure/bridge.env --profile lab_a --output /work/import-results
```

Use `import_batch.py` without `--cell` for all cells. Live master offsets are
audited before import. Bridge's staged check/save/readback transaction and
no-overwrite behavior remain intact.

Both entries produce `execution-status.json`, `import-journal.jsonl`, and
`import-result.json`. A persistent attempt marker prevents accidental replay
after interruption/failure. Inspect the native outcome before another attempt;
do not delete the marker to force a retry.

## Aether Reports

Native report artifact names remain compatible with the existing 200-circuit
workflow. Keep the manifest and reports together. Use `capture.py --help` and
`report.py --help` for options. Captures retain the whole Aether interface,
external Canvas/Aether headings and two circuit pairs per printed page. Native
PDK annotations remain; no manual W/L overlay is added.

## Validation Boundary

Run tests on Linux with the real Bridge package installed:
The report tests also require Pillow in that Python environment.

```sh
PYTHONPATH=eda python -m unittest discover -s eda/tests
node --test eda/tests/analog-canvas-aether-names.test.mjs
python eda/tests/integration.py --canvas-source /work/Analog-Canvas \
  --runtime /work/node-runtime
```

Integration uses real Canvas examples and the Bridge offline planner. External
native-session substitutes are used only in boundary tests, never as Canvas
domain replacements. Offline preflight, native database readback, EDA netlist
export and electrical equivalence are distinct checks. On Linux, the refactored
Aether CLI was exercised in the existing native session: one single-cell import
and a two-cell batch passed saved-database readback, including MOS, RLC, sources
and inverter expansion. All three used new libraries; the historical 200 cells
were not modified. Virtuoso has offline adapter tests, not native acceptance.
Full application merge/deployment gates remain separate.
