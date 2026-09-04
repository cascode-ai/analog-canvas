# Simulation Orchestration

Status: accepted

Owners: `packages/spice-run`, `apps/local-host`, `worker`,
`containers/ngspice`

Related decision: [ADR 0055](../adr/0055-simulation-is-part-of-the-product.md)

## Scope

Analog Canvas produces the reusable circuit netlist. The author supplies the
testbench intent and analysis commands. The execution environment supplies the
simulator-readable model libraries. These are separate responsibilities and
are assembled only in the transient simulation deck; none changes the Project
schema or the structural netlist export.

This contract covers deck assembly, model-library selection, and, since the
2026-09-04 amendment of ADR 0055, the shape of a run: its inputs, root,
sources and analyses, execution boundary, lifecycle, and result data. It does
not define the editor workflow, which follows the editor interaction spec
once the pieces exist.

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

This envelope establishes provenance only. The numbers themselves are
[Result data](#result-data). Bindings from a probe back to circuit objects
are produced at compile time and are not part of reading a rawfile.

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

### How the hosted container meets it

The numbers below belong to `containers/ngspice` and are enforced there,
independently of anything the Worker in front of it checked. The Worker's
request shape is unchanged by any of it; the response fields are additive.
None of it depends on which base image is pinned: the base is a build
argument and its digest is the environment lock.

**Account and filesystem.** The harness and the simulator run as uid 10001.
The simulator, the model tree, and the harness are not writable by that
account — the harness is stripped of every write bit at build time, while the
base image's own trees are corrected only where a file is group- or
other-writable, because a recursive `chmod` over gigabytes of models would
double the image for a tree that is already root-owned. That the property
holds is asserted, not assumed: the container workflow tries to write each
path as the run account and requires failure.

The directory those run directories are made under is prepared by the image
and belongs to the run account. It is deliberately not under `/run`: a
container runtime may mount its own filesystem there, replacing the prepared
directory with one the run account cannot write. The harness probes the root
it is given once at startup and falls back to the platform temporary
directory if it must, reporting both through `GET /health`, and a run that
still cannot get a directory is answered `run-directory-unavailable` — a
statement about the container, never about the circuit.

Each run gets a private directory, made immediately before it and removed
whole immediately after it however it ended. That directory is the
simulator's working directory, its `HOME`, and its `TMPDIR`, and it is the
only writable location the simulator is given, so one author's deck can
neither read nor overwrite what another's wrote. The deck is written there as
`deck.cir` and named relatively, so no host path appears in the log the
author reads.

**Environment.** The simulator's environment is constructed, not inherited:
`PATH`, `HOME`, `TMPDIR`, `TERM`, and a `C` locale, and nothing else. A
`.control` block can print its environment, and nothing the hosting platform
placed in the harness's own is a simulator input. The identity probe that
names the simulator at startup runs under the same environment, and under a
five-second deadline — `/health` and the first run both wait on its answer,
so a binary that never returns from `--version` would otherwise leave the
container permanently not-ready and unable to say why.

The run's directory holds a `.spiceinit` containing `set filetype=ascii`, so
`write` produces the ASCII rawfile that [Result data](#result-data) is read
from.
That is an environment setting, not an edit to the deck: the author's own
`.control` block overrides it, and the deck's text is never modified.

**Deadline.** The simulator is started in its own session and the deadline
signals the whole process group. A deck whose `.control` block shells out
otherwise leaves a child running past the deadline it was started under,
still writing, with the container's slot already given to the next caller.

**Limits.**

| Limit | Value | Enforced by |
| --- | --- | --- |
| Deck size | 2 MiB | rejected `413 deck-too-large` |
| Request body | 4 MiB | connection closed, `413 request-too-large` |
| Returned output | 1 MiB per run | truncation, reported |
| Default deadline | 30 s | applied when the caller names none |
| Maximum deadline | 120 s | a longer request is clamped to it |
| Identity probe | 5 s | given up on, not waited for |
| Processes | 128 (`RLIMIT_NPROC`) | image-set `ulimit` before `exec` |
| Written file size | 256 MiB (`RLIMIT_FSIZE`) | image-set `ulimit` before `exec` |

The returned-output cap is divided between the simulator's two streams, so a
flood of printed values on one cannot push the single line that explains the
run off the end of the other. The two kernel limits are set by the image
rather than defaulted by the harness, because `RLIMIT_NPROC` counts every
process the account owns and a number chosen for a container that runs one
simulator is wrong anywhere else.

**Added response fields.** A consumer that does not read these is unaffected.

```ts
interface ContainerRunResponse {
  /** Capped; carries a one-line notice in the text when it was cut. */
  log: string;
  /** True when the log or the rawfile reached the cap. */
  truncated: boolean;
  truncatedOutputs: ("log" | "rawfile")[];
  /** The rawfile's text when the deck asked for one and it is ASCII. */
  rawfile: string | null;
  rawfileName: string | null;
  rawfileFormat: "ascii" | "binary" | null;
  /** The limits above, with the deadline this run actually got. */
  limits: Record<string, number | null>;
}
```

A truncated result says so rather than arriving quietly shortened, because a
shortened log read as a whole one is a wrong answer about a circuit. The
rawfile is returned when the deck contains `.save` or `write`, verbatim and
under the same cap; turning its vectors into numbers is
[Result data](#result-data) and is not done here.

**Readiness.** `GET /health` answers during a run as well as between runs,
reporting the environment facts, the limits, and whether the slot is taken. A
check that can only ask when the container is idle cannot tell a busy
simulator from a broken one. A missing simulator binary or model tree answers
`503 not-ready` rather than a success with absent facts.

## Run lifecycle

The service exposes `prepare`, `start`, `read`, `cancel`, and `export`.
`start` executes exactly the prepared input whose digest it was given and
returns a short receipt with a run id; `read` returns status or the final
result and may wait briefly; `cancel` terminates the process and frees the
slot. A run id is bound to the session or Project owner that started it.
There is no run history store: a receipt that outlives the runner's memory
reads as lost, and a lost run is never silently rerun.

## Result data

Numbers are read from ngspice's ASCII rawfile, never from console text. The
result extends `SimulationResult` with:

- `op`: one entry per probe with `value` and `unit`;
- `ac`: `frequencyHz` and, per probe, `real` and `imag` arrays of the same
  length; magnitude and phase are derived from these, and a magnitude is
  labelled a gain only when the author has named an input and an output;
- `tran`: `timeSeconds` as computed by the solver and, per probe, a `value`
  array of the same length; different plots keep their own axes and are not
  resampled to share a table.

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
- **The sweep column is declared, not positional.** The frequency or time axis
  is taken by the quantity ngspice declared for it. A plot that declares none
  is refused rather than having an axis guessed for it.

A rawfile may hold several plots back to back, and each is read on its own
terms. A binary rawfile is refused by name: a testbench that wants numbers
sets `filetype=ascii` before it writes.

A plot this release does not read -- a DC sweep, a noise analysis -- is
reported by name as a `warning` beside the analyses that were read, and as an
`error` when it was the only plot in the file. It is never dropped in silence.

### No number is invented

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

Checking that a *requested* vector is present belongs to the caller, because
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
a rawfile with no vectors classifies as `failed` -- reached, like every other
failure, through an error diagnostic rather than through an exit code.

### CSV

`simulationAnalysisToCsv` is a pure function over one parsed analysis. Its
shape follows the analysis rather than one universal table:

- **op** -- `variable,value,unit`, one row per probe.
- **ac** -- `frequency [Hz]`, then `re(<probe>)` and `im(<probe>)` per probe.
  Both parts, never a magnitude.
- **tran** -- `time [s]`, then one column per probe, one row per point, over
  the run's own uneven time points.

Values are written as the shortest decimal that reads back as the same double,
so a round trip through the CSV loses nothing the rawfile carried.

## Rollout

The hosted route ships on the preview channel first (ADR 0057), where the
container is bound; production receives the binding with a promoted
release. A deployment without the binding answers
`simulation-not-configured`, a fact about the deployment.

## Deterministic validation (first release)

- Closed-form fixtures under `fixtures/ngspice-rawfile/`: a resistor divider
  operating point, an RC low-pass AC sweep, and an RC step transient, each
  with the deck that produced it. The parser is asserted against the
  arithmetic, not against itself: AC to a relative tolerance of `1e-12`,
  transient to `1e-3`, on a time axis whose step spans six orders of
  magnitude.
  `packages/spice-run/src/rawfile.test.ts` and `result-data.test.ts` hold
  those assertions. `v(mid)` is exactly 0.5 V. All 17 AC points are checked
  against `H(f) = 1/(1 + jf/f_c)` with `f_c = 159.1549 Hz`, agreeing to
  4.7e-16 in magnitude and 2.1e-14 degrees. The transient `v(in)` column is
  reproduced bit-exactly by evaluating the deck's own `PULSE` card at the
  recovered timesteps, which a reconstructed grid cannot do, and Ohm's law on
  R1 ties every column together at every point. The step response
  `1 - exp(-t/tau)` is asserted over the 57 points from 1 us onward, where the
  worst relative deviation is 4.8e-4. That residual is the deck's, not the
  reader's, and has two causes of opposite sign, asserted separately: the
  source ramps over 1 ns rather than stepping, leaving the output a fixed
  `t_r/(2*tau)` = 5e-7 V below the ideal curve, which is the whole error near
  1 us; and trapezoidal integration over 80 us steps overshoots by 3.8e-5
  relative by the end of the run. Below 1 ns the source is still ramping, so
  the step formula describes a different circuit and is not asserted there.
- `scripts/simulation-acceptance.mjs`: the five-transistor OTA from
  `analog-arena`, exported by this product and simulated against the
  reference netlist under one testbench, agreeing on node voltages, gain,
  and unity-gain bandwidth.
- `containers/ngspice/entrypoint.test.mjs` starts the harness as a real
  process and asserts the execution boundary against stand-in simulators
  that misbehave deliberately: a private directory per run that is removed
  afterwards, a constructed environment, the single slot's `503` and
  `Retry-After`, a deadline that kills a forked grandchild, the clamped
  deadline ceiling, output and rawfile truncation, and readiness.
- `.github/workflows/container.yml` builds the image on every pull request
  that touches it and asks the built image itself: that it runs as the
  unprivileged account, that the simulator, models, and harness refuse that
  account's writes, that the pinned base still carries the continuous
  library, that a resistor divider comes back with its operating point and
  its rawfile, and that a second concurrent run is refused.
- The preview deploy simulates one circuit through the real container on
  every merge.
