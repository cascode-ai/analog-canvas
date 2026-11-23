# Simulation Numeric Results

Status: accepted

Owners: `packages/spice-run`, `packages/simulation-service`

[Setup and compilation](simulation.md) owns acquisitions; [execution](simulation-execution.md)
owns receipts and artifacts. Exact shapes:
[`result-data.ts`](../../packages/spice-run/src/result-data.ts),
[`result-schema.ts`](../../packages/spice-run/src/result-schema.ts).

## Result data

- `result.data` exposes captured native vectors without needing an Output
  binding. Prepared `signalNames` is run-local Canvas metadata; it never
  renames vectors or changes connectivity. No second evaluated waveform set,
  automatic measurement summary or device OP table for new runs.
- `SimulationResultData` version 1 has a non-empty `analyses` array, each with
  native plot name, probes and axis/value fields: `op` (`value`, `unit`),
  `dc` (declared `sweep` + equal-length values), `ac` (`frequencyHz`, `real`
  and `imag`; magnitude/phase is the consumer's job), `tran` (solver
  `timeSeconds`; plots are never resampled to share axes), `noise`
  (frequency, output and input-referred ASD, two integrals; input unit from
  the selected source).
- Records keep rawfile order; repeated analyses are never deduplicated.
  Optional `rawPlotOrdinals`/`rawPlots` map analyses to source records
  (ordinals are per rawfile). `quantity` is the simulator's word; `unit` the
  SI symbol or `null`. `data` is absent without a rawfile. It is distinct
  from the legacy `outputData` envelope, whose evaluated `analyses` new runs
  do not fill.
- Probes name existing objects plus hierarchy occurrence; the
  probe→vector mapping is made at compile time, never inferred from results.
- Vector spellings are exact identities: lookup, IDs, labels and CSV never
  case-fold (VACASK can return `Out` and `out`). Name normalization belongs to
  the source adapter. ngspice authored call paths ignore case within the same binding. Physical AC acquisitions stay complex with units even
  when all imaginary parts are zero.

## Reading the rawfile

Numbers come from the ASCII rawfile, never console text.

- Points are split on blank lines and the count must equal `No. Points` (a
  fixed-line reader misreads complex files).
- `Flags: complex` means every value is `real,imaginary`; a real plot has no
  imaginary part, not zeros.
- The sweep column is the declared quantity; a 1-D DC plot uses its single
  `v-sweep`/`i-sweep`. No axis, or several DC axes, is refused.
- Several plots are read independently. Binary rawfiles are refused by name
  (`filetype=ascii`).
- ngspice `noise` = exactly one `Noise Spectral Density Curves` (`frequency`,
  `onoise_spectrum`, `inoise_spectrum`, amplitude per √Hz) plus one
  `Integrated Noise`; repeats keep raw evidence with a diagnostic, never
  guessed pairs. Unread plots are a `warning` by name, an `error` when alone.
  No supported analysis left → unusable.
- VACASK noise: native PSD kept; ASD = `sqrt(output PSD)` and
  `sqrt(output PSD / squared transfer)`; undefined referral is null, not 0.
  Integrals are trapezoidal RMS estimates over recorded samples
  (`integrationMethod: "trapezoidal-psd"`, labelled `sampled PSD`), no
  extrapolation, sorting or bridging; missing ones are absent (blank in CSV,
  omitted in GUI/MCP).
- `dims=1` short vectors in AC/DC/TRAN become the record's `scalars` (first
  value); padding is not sweep data. Undeclared constants stay waveforms;
  malformed dimensions are diagnostics.

No number is invented: missing or unusable values produce a diagnostic naming
the variable and line; nothing is padded, interpolated or carried forward.

| code                    | what the file did                                     |
| ----------------------- | ----------------------------------------------------- |
| `empty-file`            | no rawfile content at all                             |
| `unsupported-format`    | a binary rawfile, or not a rawfile                    |
| `header-incomplete`     | ends before a plot is fully described                 |
| `header-invalid`        | a header line is unreadable or missing                |
| `variable-line-invalid` | a `Variables:` line declares no index, name, quantity |
| `point-block-invalid`   | a point has the wrong number of values, or no index   |
| `point-count-mismatch`  | recovered points disagree with `No. Points`           |
| `value-malformed`       | a value is not a number                               |
| `value-not-finite`      | a value is `nan`, `inf`, or an overflow               |

Checking that a requested vector exists is the caller's job.

## Run verdict

A reading is `{status: "read", data, diagnostics}` or
`{status: "unusable", diagnostics}` with at least one `error`; its
diagnostics join the run's. One pure evaluator in `@icm/spice-run` decides
the verdict for Worker, Agent, GUI and hosted checks:

- rawfile requested → `completed` needs a readable file with ≥ 1 supported
  analysis and its vectors; no rawfile → positive evidence ngspice accepted
  the deck (`Circuit:` banner or analysis output), not arbitrary stderr;
- a non-zero exit is diagnostic, not decisive, when all results arrived;
- ngspice's own error lines name and locate the cause, collapse duplicates
  and suppress the generic epilogue once a cause is known
  (`fixtures/ngspice-failures/` pins them).

Electrical qualification may add environment, probe and tolerance checks
without reclassifying the run. Hosted results with rawfile dimensions are
re-read by the canonical reader; missing data is never resurrected; archives
without dimension evidence must be rerun.

## Measurements

Console `meas`/`report_measurement` reports come only from the executed
include graph, keep Console order and are never associated with raw records
by name. Native `meas` enters the Spec report; raw scalars stay in raw
data/CSV. Optional `* @spec` (ngspice) / `// @spec` (VACASK) comments declare
limits, ranges or targets; the source adapter owns includes, sections and
names. One shared evaluator reads captured input only: missing/ambiguous
metrics are not evaluated, metrics without rules unconstrained
([Spec annotations](../agent/simulation-specs.md)). VACASK values without
rules use `source.kind: "log"` with declared units. Legacy JSON measurement
configuration stays readable but is not regenerated.

## CSV

`simulationAnalysisToCsv` is pure over one parsed analysis: op
`variable,value,unit`; dc sweep + values; ac `frequency [Hz]`, `re(<probe>)`,
`im(<probe>)` (never magnitude); tran `time [s]` over the run's own points.
Scalars follow in a separately headed table. Values are the shortest decimal
that round-trips. Files: `<analysis>-<record-index>.csv` per analysis,
`specs.csv` and `specs.json`; no `outputs-*.csv`, `measurements.csv` or OP
CSV for new runs. Unknown units stay unknown (`_db` is not a unit).

## Historical output compatibility

Archived outputs may carry `semantics` (`valueKind`, `quantity`, `origin`,
native `expression`) derived from the executed source snapshot, never from
editor text or name suffixes; archives without it and `outputs.json` stay
readable. Complex storage is no instruction to take magnitude; native `db`,
`ph`/`cph` and degree results are not transformed again; bounded inference
never runs ngspice. Plots, comparison and image export are not product
features.
