# Simulation Numeric Results

Status: accepted

Owners: `packages/spice-run`, `packages/simulation-service`

[Setup and compilation](simulation.md) owns acquisitions and expressions;
[execution](simulation-execution.md) owns receipts, artifacts, and their lifetime.

## Result data

The shared service exposes every returned native vector alongside configured
expressions, without requiring an output binding for `save` to work. Direct
acquisition duplicates are suppressed. Prepared `signalNames` is optional,
derived run-local metadata mapping native voltage vectors to Canvas paths/names;
it does not rename the raw data or change connectivity. Native results retain
their executable spelling alongside friendly names, including in MCP and CSV.

Numbers are read from ngspice's ASCII rawfile, never from console text. The
parsed result extends `SimulationResult` with:

- `op`: one entry per probe with `value` and `unit`;
- `ac`: `frequencyHz` and, per probe, `real` and `imag` arrays of the same
  length; magnitude and phase are derived from these, and a magnitude is
  labelled a gain only when the author has named an input and an output;
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

### The shape it takes

```ts
interface SimulationResultData {
  schemaVersion: 1;
  analyses: readonly SimulationAnalysisResult[]; // never empty
}

interface SimulationProbe {
  name: string; // ngspice's own vector name: `v(out)`, `i(v1)`
  quantity: string; // ngspice's own word: `voltage`, `current`
  unit: string | null; // the SI symbol, or null when unrecognised
}

type SimulationAnalysisResult =
  | {
      analysis: "op";
      plotName: string;
      probes: (SimulationProbe & { value: number })[];
    }
  | {
      analysis: "dc";
      plotName: string;
      sweep: SimulationProbe & { values: readonly number[] };
      probes: (SimulationProbe & { value: readonly number[] })[];
    }
  | {
      analysis: "ac";
      plotName: string;
      frequencyHz: readonly number[];
      probes: (SimulationProbe & {
        real: readonly number[];
        imag: readonly number[];
      })[];
    }
  | {
      analysis: "tran";
      plotName: string;
      timeSeconds: readonly number[];
      probes: (SimulationProbe & { value: readonly number[] })[];
    }
  | {
      analysis: "noise";
      plotName: "Noise Analysis";
      frequencyHz: readonly number[];
      outputNoiseDensity: readonly number[];
      inputNoiseDensity: readonly number[];
      integratedOutputNoise: number;
      integratedInputNoise: number;
      units: {
        outputDensity: "V/sqrt(Hz)";
        inputDensity: "V/sqrt(Hz)" | "A/sqrt(Hz)";
        integratedOutput: "V";
        integratedInput: "V" | "A";
      };
    };
```

`quantity` is ngspice's own word, kept unedited for the same reason a
diagnostic keeps ngspice's own text. `unit` is the SI symbol when the quantity
is one we recognise and `null` when it is not, because a wrong unit on an axis
is worse than no unit. `SimulationResult` gains an optional `data` field
carrying this; it is absent when the runner had no rawfile to read.

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
and Preview checks:

- when the deck requested a rawfile, `completed` requires a readable file with
  at least one supported analysis and its vectors;
- when the deck requested no rawfile, `completed` requires positive evidence
  that ngspice accepted the deck, such as its `Circuit:` banner or analysis
  output; arbitrary non-empty stderr is not evidence;
- a non-zero exit code remains diagnostic rather than decisive when all
  requested results arrived, because supported ngspice builds disagree about
  the exit status of otherwise identical completed control-block runs.

Preview qualification may additionally require a named environment, probes,
and numeric tolerances. It does not reclassify the underlying run.

### Captured native scalars

AC, DC and transient plots may include short vectors declared by ngspice's
`dims=1` variable qualifier. Their first real/imaginary value is captured in
the record's optional `scalars` array; the remaining rawfile padding is not
sweep data. Constant waveforms and single-point sweeps without that declaration
remain waveforms. Unsupported short arrays and malformed dimensions produce
diagnostics instead of being plotted against the wrong axis.

The evaluated record also carries `scalars`, separate from curve `outputs`.
Results shows these in a **Captured values** table per record, preserving signed
and complex numbers. They do not generate curve min/max/span/RMS summaries and
are not image-export traces. Both raw and evaluated CSV append a separately
headed scalar table. Unknown units stay explicitly unknown; a variable suffix
such as `_db` does not establish a unit.

Console measurement reports remain separate evidence: only declarations reached
from the executed entry/include graph participate, and repeated report names
retain Console order. The UI does not invent an association between Console
lines and raw records. A value may therefore appear as both a captured scalar
and a Console report, with their different provenance made explicit.

Hosted responses with numeric data and explicit rawfile dimensions are re-read
by the same canonical reader to handle executor-image version skew. Missing
numeric data is not resurrected. Archives without retained dimension evidence
cannot be safely repaired from names or zero padding; rerun them to capture
the corrected result.

### Authored measurements

An authored measurement references one enabled analysis and one named Output.
It stores a stable ID, display label, and one scalar reduction: OP `value`,
`sample-at`, `minimum`, `maximum`, `peak-to-peak`, or time-weighted TRAN
`mean`/`rms`. Minimum, maximum, and peak-to-peak may use the complete analysis
or an explicit SI-domain window; mean and RMS require a time window. The rule,
not its observed number, is Project state. A Run evaluates rules after Output
expressions and returns authored rows beside separately identified automatic
summaries. A rule that is outside returned data or cannot reduce a complex
Output is locally `unavailable`; it does not fail an otherwise successful Run.

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

Structured evaluated outputs also carry conservative automatic measurements.
OP contributes its scalar value; DC, AC, and TRAN contribute minimum, maximum,
and span (complex AC outputs use magnitude); TRAN additionally contributes
time-weighted mean and RMS over its actual, possibly nonuniform time samples.
Each row is independently `available` or `unavailable` with a reason. A missing
crossing or insufficient sample window must not become zero and must not change
an otherwise completed Run into a failed Run. The service is the sole numerical
owner: GUI, Agent responses, and `measurements.csv` consume the same rows.

## Plot semantics and grouping

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

Waveform views group compatible units and representations, with independent
vertical axes. Unknown outputs are isolated, not labelled dimensionless.
Users may separate each trace for scale differences and declare an unknown
display unit; declarations label existing values rather than converting them.
Within one analysis record, plots share horizontal range, history and cursors.
Repeated records remain separate, with independent view state. These preferences
are session-only and do not modify Code, the Project, or the simulation input.
Image exports use the same renderer; raw numeric exports retain recorded values.
Older archives without sufficient semantics use conservative raw/real display
for unknown values instead of guessing from names. XY plots, cross-run alignment
and persisted plot templates are outside this contract.

## Validation evidence

Rawfile, result-data, expression, and measurement tests protect parsing and
numerical meaning. Closed-form fixtures and model-backed hosted qualification
are distinct evidence; see [execution validation](simulation-execution.md#validation).
