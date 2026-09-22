# Simulation Numeric Results

Status: accepted

Owners: `packages/spice-run`, `packages/simulation-service`

[Setup and compilation](simulation.md) owns acquisitions and expressions;
[execution](simulation-execution.md) owns receipts, artifacts, and their lifetime.

## Result data

The shared service exposes captured native vectors in `result.data`, without
requiring an Output binding for `save` to work. Prepared `signalNames` is optional
run-local Canvas metadata; it never renames raw vectors or changes connectivity.
New runs do not compute a second evaluated waveform set, automatic measurement
summaries or a product-specific device OP table. Native OP remains a raw analysis;
repeated records keep their identity even when their numbers happen to match.

Waveform numbers are read from ngspice's ASCII rawfile, never from console text. The
parsed result extends `SimulationResult` with:

- `op`: one entry per probe with `value` and `unit`;
- `dc`: the declared `sweep` vector with its `values` and, per probe, a `value`
  array of the same length;
- `ac`: `frequencyHz` and, per probe, `real` and `imag` arrays of the same
  length; any magnitude, gain or phase processing belongs to authored native
  code or the consuming Agent, not a second product evaluator;
- `tran`: `timeSeconds` as computed by the solver and, per probe, a `value`
  array of the same length; different plots keep their own axes and are not
  resampled to share a table.
- `noise`: the frequency axis, output and input-referred amplitude spectral
  densities, and the two integrated totals. The input-referred unit follows
  the selected independent voltage or current source.

Array lengths, analysis and probe identities, non-finite values, an empty or
truncated rawfile, and a requested vector that is missing are all checked; an
exit code of zero is not evidence that the requested results exist. CSV is
derived from this data (AC keeps real and imaginary parts; transient keeps
the real time points) and never from a second parse.

Probes name existing objects (a terminal, a Route, a Junction, or a Base Net)
plus the hierarchy occurrence; the mapping from probe to simulator vector
name is produced at compile time and never inferred from result text. Raw
input carries no Canvas mapping unless one is proven valid.

Simulator vector spellings are exact result identities. Acquisition lookup,
native output/scalar IDs, friendly labels and CSV must not case-fold them:
VACASK can return `Out` and `out` with different values. Name normalization,
when required by a source language, belongs to its source/compiler adapter,
not the shared numerical consumer. Physical AC acquisitions retain their proven
units and complex semantics even when their names lack SPICE `v(...)` syntax
and all imaginary samples are zero. Native VACASK source inspection and
execution now run beside ngspice; the selected Profile chooses the engine.

### Reading the rawfile

Three properties of the ASCII rawfile are load-bearing, and all three were
taken from files ngspice 46 wrote rather than from a description of the
format:

- **A point is separated from the next by a blank line.** One point is an
  indexed line followed by one line per remaining variable, then a blank line.
  The value block is split on the blank line and the recovered count is
  checked against the header's `No. Points`. A mismatch is an error, never a
  shorter result. A reader that instead advances a fixed number of lines, or
  groups numeric tokens by variable count, happens to agree on a real-valued
  file and silently misreads a complex one, where each line carries two
  numbers.
- **A complex plot writes every value as `real,imaginary`.** `Flags: complex`
  is what says so. A real plot reports no imaginary part rather than a column
  of zeros, so an absent one cannot be mistaken for a measured one.
- **The sweep column is declared, not positional.** Frequency and time axes use
  the quantity ngspice declared. A one-dimensional DC plot uses its single
  ngspice `*-sweep` vector (`v-sweep` or `i-sweep`). A plot that declares no
  axis, or several DC axes, is refused rather than guessed.

A rawfile may hold several plots back to back, and each is read on its own
terms. A binary rawfile is refused by name: a testbench that wants numbers
sets `filetype=ascii` before it writes.

The two plots written by one ngspice 46 `noise` command are one result:
`Noise Spectral Density Curves` carries `frequency`, `onoise_spectrum`, and
`inoise_spectrum`; `Integrated Noise` carries the input- and output-referred
totals. Exactly one of each is required. Density quantities are amplitudes per
square-root hertz, not squared densities. Any other plot this release does not
read is reported by name as a `warning` beside the analyses that were read,
and as an `error` when it was the only plot in the file. It is never dropped
in silence.

The native VACASK adapter projects its single noise PSD record into this same
numerical contract. It keeps the native vectors and records ASD as
`sqrt(output PSD)` and `sqrt(output PSD / squared transfer)`, with input units
supplied by the prepared source identity. Undefined input referral is a null
sample, not zero.
VACASK does not supply the two ngspice-style integral records. The adapter's
`integrationMethod: "trapezoidal-psd"` explicitly identifies an RMS estimate
from trapezoidal integration of recorded PSD samples over the recorded band.
It neither extrapolates nor sorts frequencies nor bridges unavailable samples.
Missing integrals are absent; CSV leaves their values blank, and shared GUI/MCP
outputs omit those scalars. Available estimates are labelled `sampled PSD`.
Native PSD and device-contribution vectors remain available alongside ASD.

### No number is invented

A missing or unusable value produces a diagnostic naming the variable and the
rawfile line. Nothing is padded, interpolated, or carried forward from a
neighbouring point, because a fabricated number is indistinguishable from a
measured one once it reaches a chart. The refusals are:

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

Checking that a _requested_ vector is present belongs to the caller, because
only the compiled setup knows what was asked for. This layer reports what the
file holds.

### Result identity and schema

The executable contracts live in
[`result-data.ts`](../../packages/spice-run/src/result-data.ts) and
[`result-schema.ts`](../../packages/spice-run/src/result-schema.ts), rather than
an independently maintained TypeScript copy here. `SimulationResultData`
version 1 contains a non-empty `analyses` array. Each analysis keeps its native
plot name, probes and analysis-specific axis/value fields.

Records retain rawfile order. Repeated analyses with identical values are not
deduplicated. `rawPlotOrdinals` maps a parsed analysis to its source records;
`rawPlots` inventories headers, variables, point counts and optional parsed
analysis indices, including records not projected into a supported analysis.
These fields are optional for historical results. Ordinals are scoped to one
captured rawfile, not stable cross-run identities.

Noise is projected only when the file has exactly one density record and one
integrated record. Repeated Noise records retain raw evidence and produce a
diagnostic; the reader does not guess pairs from names, values or position.
If no supported analysis remains, the reading is unusable.

`quantity` is ngspice's own word, kept unedited. `unit` is the SI symbol when
recognised and `null` otherwise. `SimulationResult.data` is absent when the
runner had no rawfile to read. This numeric payload is distinct from the
service's `outputData` Spec-report envelope: new runs do not repopulate its
legacy evaluated-waveform `analyses` array.

### A run with no vectors is not a success

A simulator can exit 0, print a plausible batch log, and leave behind a
rawfile with nothing in it. Reported as a success carrying an empty result,
that reaches the author as a blank chart and no explanation, which is the
least actionable thing this product can do. So reading a rawfile yields either
analyses or a reason there are none:

```ts
type SimulationDataReading =
  | {
      status: "read";
      data: SimulationResultData;
      diagnostics: SimulationDiagnostic[];
    }
  | { status: "unusable"; diagnostics: SimulationDiagnostic[] };
```

There is no reading that succeeded with nothing in it: `analyses` is never
empty, and an `unusable` reading always carries at least one `error`
diagnostic saying what to go look at. Those diagnostics join the run's own, so
an explicitly requested rawfile with no vectors classifies as `failed` -- reached, like every other
failure, through an error diagnostic rather than through an exit code.

The same evidence policy covers the absence of a file. One pure evaluator in
`@icm/spice-run` owns the terminal verdict consumed by the Worker, Agent, GUI,
and hosted checks:

- when the deck requested a rawfile, `completed` requires a readable file with
  at least one supported analysis and its vectors;
- when the deck requested no rawfile, `completed` requires positive evidence
  that ngspice accepted the deck, such as its `Circuit:` banner or analysis
  output; arbitrary non-empty stderr is not evidence;
- a non-zero exit code remains diagnostic rather than decisive when all
  requested results arrived, because supported ngspice builds disagree about
  the exit status of otherwise identical completed control-block runs.

Electrical qualification may additionally require a named environment, probes,
and numeric tolerances. It does not reclassify the underlying run.

### Captured native scalars

AC, DC and transient plots may include short vectors declared by ngspice's
`dims=1` variable qualifier. Their first real/imaginary value is captured in
the record's optional `scalars` array; the remaining rawfile padding is not
sweep data. Constant waveforms and single-point sweeps without that declaration
remain waveforms. Unsupported short arrays and malformed dimensions produce
diagnostics instead of being plotted against the wrong axis.

Raw analysis CSV appends a separately headed scalar table, preserving signed and
complex numbers. Scalars are not padded into waveforms or automatically promoted
to acceptance metrics. Unknown units stay unknown; a suffix such as `_db` does
not establish a unit. There is no second evaluated CSV or built-in plot renderer.

Console measurement reports remain separate evidence: only declarations reached
from the executed entry/include graph participate, and repeated report names
retain Console order. The UI does not invent an association between Console
lines and raw records. Native `meas` reports enter the captured Spec report; raw
scalars stay in raw data/CSV. Neither source is substituted for the other merely
because names match. Repeated or missing measurement names follow the explicit
ambiguity and non-evaluated rules in [Spec annotations](../agent/simulation-specs.md).

Hosted responses with numeric data and explicit rawfile dimensions are re-read
by the same canonical reader to handle executor-image version skew. Missing
numeric data is not resurrected. Archives without retained dimension evidence
cannot be safely repaired from names or zero padding; rerun them to capture
the corrected result.

### Authored measurements

Native `meas` computes authored scalar metrics. Optional `* @spec` source comments
declare acceptance limits, inclusive ranges or targets with absolute tolerance.
The shared Spec report evaluates captured input only; missing/ambiguous metrics
are not-evaluated, and metrics without rules are unconstrained. Legacy JSON
measurement configuration and historical output schemas remain readable, but
new runs do not regenerate those old reduction tables.

### CSV

`simulationAnalysisToCsv` is a pure function over one parsed analysis. Its
shape follows the analysis rather than one universal table:

- **op** -- `variable,value,unit`, one row per probe.
- **dc** -- the recorded sweep column and per-probe values.
- **ac** -- `frequency [Hz]`, then `re(<probe>)` and `im(<probe>)` per probe.
  Both parts, never a magnitude.
- **tran** -- `time [s]`, then one column per probe, one row per point, over
  the run's own uneven time points.

Values are written as the shortest decimal that reads back as the same double,
so a round trip through the CSV loses nothing the rawfile carried.

There is one `<analysis>-<record-index>.csv` per captured analysis, plus `specs.csv`
for the acceptance table. `specs.json` exposes the same report to machine clients
and diagnostic exports. No `outputs-*.csv`, automatic `measurements.csv` or
specialized device-operating-point CSV is generated for new runs.

## Historical output compatibility

Evaluated outputs may carry `semantics`: `valueKind` (`real`, `complex`, or
`unknown`), the raw `quantity`, `origin` (`raw` or `expression`), and the
captured native `expression` when available. This metadata is derived from
the executed source snapshot, never from later editor text or variable-name
suffixes. Existing archives without it remain readable.

Complex rawfile storage is not an instruction to take magnitude. Physical AC
acquisitions remain complex even when every imaginary sample is zero. Native
`db`, `ph`/`cph`, and supported explicit degree conversions are already real
results: their signs are preserved without applying another magnitude, logarithm,
or phase transformation. Source inference is deliberately bounded; conflicting
assignments, dynamic control programs and unsupported expressions stay unknown.
It does not execute ngspice or replace its numeric results.

These fields describe retained legacy archives, not a second result pipeline
for new runs. Archived `outputs.json` remains readable for old run recovery.
Plots, comparison, display grouping and image export are no longer product
features; external consumers choose their own transformations and presentation.

## Validation evidence

Rawfile, result-data, expression, and measurement tests protect parsing and
numerical meaning. Closed-form fixtures and model-backed hosted qualification
are distinct evidence; see [execution validation](simulation-execution.md#validation).
