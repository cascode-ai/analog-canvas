# Simulation Orchestration

Status: accepted

Owners: `packages/spice-run`, `apps/local-host`, `worker`

Related decision: [ADR 0055](../adr/0055-simulation-is-part-of-the-product.md)

## Scope

Analog Canvas produces the reusable circuit netlist. The author supplies the
testbench intent and analysis commands. The execution environment supplies the
simulator-readable model libraries. These are separate responsibilities and
are assembled only in the transient simulation deck; none changes the Project
schema or the structural netlist export.

This contract covers deck assembly, model-library selection, and, since the
2026-09-04 amendment of ADR 0055, the shape of a run: its inputs, root,
sources and analyses, execution boundary, lifecycle, and result data --
including the numeric result protocol, which says how a simulator's rawfile is
read and what shape the numbers take when they leave this layer. It does not
define persisted simulation profiles, chart rendering, or the editor workflow,
which follows the editor interaction spec once the pieces exist.

## Model-library selection

A model library is never represented by a bare path. The orchestration layer
uses one of two explicit forms:

```ts
type ModelLibrarySelection =
  | { directive: "include"; path: string }
  | { directive: "lib"; path: string; section: string };
```

- `include` reads one plain model file in full and has no section.
- `lib` reads one named section from a sectioned library.
- The directive is not inferred from an extension, PDK name, or path.
- Paths are quoted when emitted and must contain no quote or line break.
- A library section is one non-empty SPICE token.

The hosted Sky130 environment runs the benchmark suite's own simulator image
(pinned by digest in `containers/ngspice/Dockerfile`) and selects the `tt`
section of its **continuous** (unbinned) library by default; deployment
configuration may override the path and section. Its valid default output is:

```spice
.lib "/opt/sky130/continuous/sky130.lib.spice" tt
```

The binned models a PDK checkout provides cap device width at 100 µm and
refuse wide devices (#551); they are not the hosted default.

It must not include that top-level sectioned library with `.include`, because
doing so expands multiple corner sections into the same deck and redefines
device wrappers. A local host with a plain standalone model file may instead
select `include` explicitly:

```spice
.include "C:/PDK Files/models/plain-models.spice"
```

The following values are rejected before a simulator runs:

```ts
{ directive: "include", path: "models.spice\"\n.end" }
{ directive: "lib", path: "models.lib.spice", section: "tt\n.end" }
```

A hosted configuration rejected at this boundary returns
`simulation-environment-invalid`; it is not reported as a circuit failure.

The library is added only when the deck needs a device model: when it
contains a semiconductor device card (MOSFET, diode, BJT, JFET) or names a
Sky130 model anywhere outside comments and continuation lines. A deck of
passives, sources, and dependent sources runs without it, because loading the
`tt` corner costs about 16 s of CPU before any analysis (measured 2026-09-04
with ngspice 46 on a resistor divider) and buys such a deck nothing. The
configuration metadata then reports `modelLibrary: null`.

## Run metadata V1

Every completed, failed, dropped-input, or timed-out simulator run carries one
transient metadata envelope:

```ts
interface SimulationRunMetadata {
  schemaVersion: 1;
  input: {
    inputRevision: string | null;
    netlistSha256: string;
    testbenchSha256: string;
    deckSha256: string;
  };
  configuration: {
    modelLibrary:
      | { directive: "include"; section: null }
      | { directive: "lib"; section: string }
      | null;
  };
  environment: {
    fingerprint: string;
    executor: "hosted-container" | "local-host";
    reproducibility: "observed" | "pinned";
    platform: string;
    simulator: {
      name: "ngspice";
      version: string;
      binarySha256: string | null;
    };
    models: { id: string; contentSha256: string } | null;
  };
}
```

The three input hashes cover the exact authored netlist, testbench, and final
deck bytes separately. `inputRevision` is opaque caller state used to reject a
stale result; it is not a durable Project identity. The model-library path is
not returned because it may reveal a local directory, while the deck hash
still covers its exact emitted spelling.

An environment fingerprint is the SHA-256 of canonical environment facts. A
consumer verifies that fingerprint before accepting a runner response. The
current container and local host report `observed`: the container measures its
ngspice binary and complete runtime model tree, while the local host reports
the facts it can observe from the user's installation. `pinned` is reserved
for a later image that verifies every input against an accepted environment
lock; metadata plumbing alone must never claim reproducibility.

This envelope establishes provenance only. The numbers themselves are the
result protocol below. Bindings from a result back to circuit objects remain
out of scope.

## Result protocol V1

### Where the numbers come from

Numbers reach this layer only by reading the ASCII rawfile ngspice writes when
a testbench calls `write`. The log is not parsed for values: a printed table is
formatted for a person, and reading one back is how a rounded number becomes a
result. A testbench that wants numbers therefore sets `filetype=ascii` before
it writes; a binary rawfile is refused, in as many words.

Three properties of that format are load-bearing, and all three were taken
from files ngspice 46 wrote rather than from a description of the format:

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
- **The sweep column is declared, not positional.** The reader takes the
  frequency or time axis by the quantity ngspice declared for it. A plot that
  declares none is refused rather than having an axis guessed for it.

A rawfile may hold several plots back to back, and each is read on its own
terms.

### No number is ever invented

A missing or unusable value produces a diagnostic naming the variable and the
rawfile line. Nothing is padded, interpolated, or carried forward from a
neighbouring point, because a fabricated number is indistinguishable from a
measured one once it reaches a chart. The refusals are:

| code | what the file did |
| --- | --- |
| `empty-file` | no rawfile content at all |
| `unsupported-format` | a binary rawfile, or not a rawfile |
| `header-incomplete` | ends before a plot is fully described |
| `header-invalid` | a header line is unreadable or missing |
| `variable-line-invalid` | a `Variables:` line declares no index, name, quantity |
| `point-block-invalid` | a point has the wrong number of values, or no index |
| `point-count-mismatch` | recovered points disagree with `No. Points` |
| `value-malformed` | a value is not a number |
| `value-not-finite` | a value is `nan`, `inf`, or an overflow |

### The shape of a result

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
  | { analysis: "op"; plotName: string; probes: (SimulationProbe & { value: number })[] }
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
      probes: (SimulationProbe & { values: readonly number[] })[];
    };
```

An operating point is a scalar and a unit per probe. An AC sweep carries
`frequencyHz` and, per probe, the real and imaginary parts as they were
solved. A transient run carries `timeSeconds` and a real value per probe.

Three rules are not negotiable at this boundary:

- **The sweep axis is the file's, never a reconstruction.** `timeSeconds` holds
  the timesteps ngspice chose. They are not evenly spaced: in the measured
  fixture they span 10 ps to 80 µs inside one run, a factor of eight million.
  No point's position is derived from its index.
- **An AC point keeps both parts and gains nothing.** No magnitude, no phase,
  and above all no gain. A magnitude is a magnitude; what it means depends on
  a testbench this layer never sees, so naming one is the reader's decision to
  make and to label.
- **An unrecognised quantity gets no unit.** `unit` is `null` rather than a
  guess, because a wrong unit on an axis is worse than no unit.

`SimulationResult` gains an optional `data` field carrying this. It is absent
when the runner had no rawfile to read — a testbench that never wrote one, or
a failure before any analysis ran.

### A run with no vectors is not a success

A simulator can exit 0, print a plausible batch log, and leave behind a
rawfile with nothing in it. Reported as a success carrying an empty result,
that reaches the author as a blank chart and no explanation, which is the
least actionable thing this product can do.

So reading a rawfile yields either analyses or a reason there are none:

```ts
type SimulationDataReading =
  | { status: "read"; data: SimulationResultData; diagnostics: SimulationDiagnostic[] }
  | { status: "unusable"; diagnostics: SimulationDiagnostic[] };
```

There is no reading that succeeded with nothing in it: `analyses` is never
empty, and an `unusable` reading always carries at least one `error`
diagnostic saying what to go look at. Those diagnostics join the run's own, so
a rawfile with no vectors classifies as `failed` even though ngspice exited 0
and logged normally — the same rule as the dropped-input case, for the same
reason.

A plot this release does not read — a DC sweep, a noise analysis — is reported
by name as a `warning` beside the analyses that were read, and as an `error`
when it was the only plot in the file. It is never dropped in silence.

### CSV comes from the same parse

`simulationAnalysisToCsv` derives CSV from a parsed analysis. It is a pure
function over the same structure a chart is drawn from, because two readers of
one format are two chances to disagree about what the file said.

The shape follows the analysis rather than one universal table:

- **op** — `variable,value,unit`, one row per probe.
- **ac** — `frequency [Hz]`, then `re(<probe>)` and `im(<probe>)` per probe.
  Both parts, never a magnitude.
- **tran** — `time [s]`, then one column per probe, one row per point, over
  the run's own uneven time points.

Values are written as the shortest decimal that reads back as the same double,
so a round trip through the CSV loses nothing the rawfile carried.

## Ownership boundary

- The circuit netlist is generated by `@icm/netlist`.
- Model-library selection belongs to the local or hosted execution
  environment, because the author cannot know container-local paths.
- Stimulus, loads, analyses, sweeps, and requested output commands remain the
  author's testbench under the current product decision.
- The deck builder appends `.end` only when the author's testbench did not
  already close the deck.

## Persistence and compatibility

The selection and assembled deck are transient execution data. No model path,
corner, testbench, simulator output, or result is persisted in the circuit
Project by this contract. It therefore requires no Project schema migration.

`ModelLibrarySelection` replaces the unpublished raw
`modelLibraryPath: string | null` package API. There is no file-format or
released HTTP request compatibility impact: the HTTP client still submits the
circuit netlist and testbench, while the execution environment owns the model
selection. Run metadata is returned with a transient result and is never saved
into the Project, undo history, Gallery, or recovery copy.

## Inputs and root

A run has exactly one input form:

- **Structured**: a `SimulationSetup` naming a `rootDocumentId` in the
  Project, the analyses to run with their parameters, and the probes to
  record. The product compiles it: the design netlist of everything the root
  reaches, one instantiation of the root, the environment's model library,
  the analyses, the saves, and `.end`.
- **Raw**: an entry SPICE file and its dependency files as submitted by the
  author or an Agent. The product resolves declared dependencies and the
  environment's library mapping, and adds nothing else: no stimulus, no
  analysis, no root call, no `.control`.

Both feed the same immutable prepared input, whose identity covers the exact
file bytes, the environment selection, and, for the structured form, every
Document the root reaches plus the setup. A change to any of them is a new
input; a result computed from an older input is stale and says so.

The simulation root is a Cell chosen for the setup. It is not
`project.topDocumentId`, and selecting it never changes the top. Extraction,
diagnostics, dependency collection, occurrence mapping, and input identity
all use the same root. A deck that only defines `.subckt`s and instantiates
nothing is not a run.

## Sources and analyses

`SimulationAnalysis` is `"op" | "ac" | "tran"`.

- `.op` has no parameters.
- `.ac` takes the sweep kind (`dec`, `oct`, or `lin`), the points per
  interval or in total, and the start and stop frequencies in hertz.
- `.tran` takes `tstep` and `tstop`, optionally `tstart` and `tmax`, all in
  seconds, finite and positive with `tstart < tstop`. No `UIC` is emitted
  unless the author asks. `tstart` does not move the start of integration,
  and `tstep` does not make the output equally spaced; the solver's time
  axis is returned as computed.

A voltage or current source instance carries its DC value, its AC magnitude
and phase, and its transient waveform as formal parameters printed by the
device descriptor. The first release's waveforms are `PULSE` (low, high,
delay, rise, fall, width, period) and `SIN` (offset, amplitude, frequency,
optional delay, damping, phase). `PWL` is reachable through raw input. The
existing pulse voltage source keeps its symbol; its clock-style parameters
are normalised into the same waveform parameters so that only one set is
authoritative.

`VDD`, `GND`, and Net labels are markers, never energy: a marker does not
become a source in the deck.

## Execution boundary

The hosted runner (`containers/ngspice`) and the local host share these
minimums before either is offered to the public:

- ngspice runs as a non-root user, in a working directory created for the
  run and removed afterwards, with a minimal environment that carries no
  platform or user secret. The model tree is read-only.
- One container runs one job at a time. A second request while a job is
  running is answered `503` with `Retry-After`; `max_instances` limits
  containers, not processes, so the harness guards its own slot.
- A timeout terminates the whole process tree and the result says
  `timedOut`. Deck size, log size, result-file size, and duration are
  capped; anything cut is reported as truncated rather than presented whole.
- Raw `.control` is permitted. Isolation, not prohibition, keeps a control
  script inside its own job.
- `GET /health` reports the observed environment facts of the metadata
  envelope so a deployment can be verified without running a circuit.

## Run lifecycle

The service exposes `prepare`, `start`, `read`, `cancel`, and `export`.
`start` executes exactly the prepared input whose digest it was given and
returns a short receipt with a run id; `read` returns status or the final
result and may wait briefly; `cancel` terminates the process and frees the
slot. A run id is bound to the session or Project owner that started it.
There is no run history store: a receipt that outlives the runner's memory
reads as lost, and a lost run is never silently rerun.

## Result data

Defined in full by [Result protocol V1](#result-protocol-v1) above, which this
section states normatively and does not repeat.

Numbers are read from ngspice's ASCII rawfile, never from console text. Array
lengths, analysis and probe identities, non-finite values, an empty or
truncated rawfile, and a requested vector that is missing are all checked; an
exit code of zero is not evidence that the requested results exist, and
neither is a non-zero one evidence of failure. CSV is derived from this data
(AC keeps real and imaginary parts; transient keeps the real time points) and
never from a second parse.

**Amendment, 2026-09-04.** This section first named three fields on
`SimulationResult` — `op`, `ac`, and `tran`. The implementation carries one
`analyses` array of tagged entries instead, and the change is recorded here
rather than left to be discovered, because a spec that describes a shape the
code does not have stops being the authority.

The substance is unchanged: an operating point is still a scalar and a unit
per probe, an AC sweep still keeps `frequencyHz` with real and imaginary parts
that no layer here calls a gain, and a transient run still keeps the solver's
own `timeSeconds`. What the array adds is the case three fixed fields cannot
express — a rawfile holding several plots, including two sweeps of the same
kind — which is what this section already required when it said different
plots keep their own axes and are not resampled to share a table.

Probes name existing objects (a terminal, a Route, a Junction, or a Base Net)
plus the hierarchy occurrence; the mapping from probe to simulator vector
name is produced at compile time and never inferred from result text. Raw
input carries no Canvas mapping unless one is proven valid.

## Rollout

The hosted route ships on the preview channel first (ADR 0057), where the
container is bound; production receives the binding with a promoted
release. A deployment without the binding answers
`simulation-not-configured`, a fact about the deployment.

## Deterministic validation

- `packages/spice-run/src/index.test.ts` verifies exact `.lib` and `.include`
  emission, quoted paths, verbatim testbench preservation, and rejected deck
  injection.
- `packages/spice-run/src/rawfile.test.ts` and `result-data.test.ts` run
  against three rawfiles ngspice 46 wrote, under
  `fixtures/ngspice-rawfile/`, each beside the deck that produced it. Every
  numeric assertion is arithmetic, never a recorded parser output: the divider
  is exactly 0.5 V; all 17 AC points are checked against
  `H(f) = 1/(1 + jf/f_c)` with `f_c = 159.1549 Hz`, agreeing to 4.7e-16 in
  magnitude and 2.1e-14 degrees; and the transient run's `v(in)` column is
  reproduced bit-exactly by evaluating the deck's own `PULSE` card at the
  recovered timesteps, which a reconstructed grid cannot do. The step response
  `1 - exp(-t/tau)` is asserted over the 57 points from 1 µs onward, where the
  worst relative deviation is 4.8e-4. That residual is the deck's, not the
  reader's, and has two causes of opposite sign: the source ramps over 1 ns
  rather than stepping, which leaves the output a fixed `t_r/(2*tau)` = 5e-7 V
  below the ideal curve and accounts for the whole error near 1 µs; and
  trapezoidal integration over 80 µs steps overshoots by 3.8e-5 relative by
  the end of the run. Both are asserted, so a later tolerance change has to
  argue with the physics rather than with a number.
- `worker/simulation.test.ts` verifies the hosted Sky130 `tt` default,
  deployment overrides, configuration-error classification, and the verified
  run metadata envelope.
- The pinned local authority pack under ignored `.reference-src/` demonstrates
  that ngspice 47 completes a Sky130 NFET operating-point deck with
  `.lib ... tt`, while top-level `.include` produces repeated subcircuit
  definitions across sections.
- `scripts/simulation-acceptance.mjs`: the five-transistor OTA from
  `analog-arena`, exported by this product and simulated against the reference
  netlist under one testbench, agreeing on node voltages, gain, and unity-gain
  bandwidth to zero relative deviation.
- The preview deploy simulates one circuit through the real container on every
  merge, so the evidence above is joined by evidence that the thing still runs
  where people use it.
