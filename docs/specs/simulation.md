# Simulation Orchestration

Status: accepted

Owners: `packages/model`, `packages/netlist`, `packages/simulation-service`,
`apps/editor/src/features/simulation`, `apps/local-host`, `worker`,
`packages/spice-run`, `containers/ngspice`

Related decision: [ADR 0055](../adr/0055-simulation-is-part-of-the-product.md)

## Scope

Analog Canvas produces the reusable circuit netlist. The author supplies the
testbench intent and analysis commands. The execution environment supplies the
simulator-readable model libraries. These are separate responsibilities and
are assembled into simulation input without changing circuit Documents or the
structural netlist export. Authored simulation intent may be saved only through
the Project `simulationSetups` collection defined below.

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

### Hosted SKY130 Profile

`containers/ngspice/hosted-sky130-profile.json` is the single machine-readable
contract for the first hosted environment. It names the digest-pinned source
image, platform, ngspice version and binary digest, complete model-tree digest,
continuous-library mapping, accepted corner, startup-policy digest, and the
device/analysis scope that has actually passed qualification. A Profile is a
runtime contract, not a sample circuit and not a promise about every device in
the SKY130 PDK.

At container startup the harness measures the real binary, model tree,
platform, and `.spiceinit` bytes. It reports `reproducibility: "pinned"` and the
Profile ID only when every measured identity matches. A missing, malformed, or
mismatched Profile leaves `/health` and `/run` not ready; it is never silently
downgraded to an observed hosted run. Local deployment is an optional adapter,
not an implicit fallback to a program found on the user's machine.

The first qualified scope is deliberately narrow and factual: the continuous
`sky130_fd_pr__nfet_01v8` and `sky130_fd_pr__pfet_01v8` wrappers, the
Profile's qualified sections (`tt/ff/ss/fs/sf`), and
OP/DC/AC/TRAN covered by the hosted model acceptance fixture. A separate
independent-source divider smoke gives DC parsing and numerical sweep behavior
an exact closed-form check on the same pinned runtime. TRAN qualification includes an ideal RC
step and a structured SKY130 OTA pulse response on the pinned ngspice 46
environment. Adding another corner or device family extends this same Profile
contract only after a model-backed fixture passes the hosted
gate; a locally available PDK is not evidence by itself.

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
    profileId: string | null;
    platform: string;
    simulator: {
      name: "ngspice";
      version: string;
      binarySha256: string | null;
    };
    models: { id: string; contentSha256: string } | null;
    startupSha256: string | null;
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
hosted container reports `pinned` only after matching the Profile at startup;
an explicitly configured local adapter must report its actual environment,
using `observed` unless it satisfies a pinned Profile. The unconfigured local
host produces no simulation metadata. Metadata plumbing alone never claims reproducibility.

This envelope establishes provenance only. The numbers themselves are
[Result data](#result-data). Bindings from a probe back to circuit objects
are produced at compile time and are not part of reading a rawfile.

## Ownership boundary

The implementation has these boundaries:

- Model owns saved setups and canonical voltage/current expressions.
- Netlist compiles structured intent. The service's preparation module resolves
  raw/structured inputs, capabilities and immutable deck identity.
- SimulationService owns preparation and the session-facing run presentation.
  Its Executor is the execution port; GUI and MCP use the same service and File
  Resource. On Preview, the managed control plane owns authoritative hosted run
  admission, idempotency, queueing, retry, cancellation and retention. Local
  and production direct transports keep the same semantic service contract.
- spice-run separates request/result types, deck assembly, metadata and terminal
  verdicts. Its public exports remain the same.
- GUI setup editing, diagnostic display and result materialization are separate
  from workspace orchestration. Charts consume scalar/complex series; derived
  outputs are not re-encoded as fake simulator analyses.

The local host has no default binary, model directory or version, and does not
probe installed software. Its optional `simulationHandler` uses the same
`/api/simulate` transport as the hosted executor. Without it, capabilities
reports `configured: false`, and execution returns
`simulation-not-configured`; Editor and saved inputs remain usable.

Run reads return bounded receipts. Full `result.json` and `outputs.json`
remain File artifacts; the GUI materializes these only when a receipt is a
preview. MCP keeps paged file access instead of receiving unbounded arrays.
Input freshness is cached per Project structure revision and setup ID; raw
dependency declarations participate in identity, not a separate unavailable state.
Switching setups restores their session-local results; these are not saved in
the Project. Lost responses never trigger an automatic second execution.

- The circuit netlist is generated by `@icm/netlist`.
- Model-library selection belongs to the local or hosted execution
  environment, because the author cannot know container-local paths.
- Stimulus sources and loads are ordinary Instances in the author's Testbench
  Cell. Their connectivity and source parameters remain authoritative on those
  Instances. Analyses, sweeps, named outputs, and the environment selection
  belong to the structured `SimulationSetup`.
- The deck builder appends `.end` only when the author's testbench did not
  already close the deck.

## Persistence and compatibility

A Project owns a bounded collection of named `SimulationSetup` records. Each
record is independently addressable by stable `id`, has an editable `name`,
and contains exactly one input form:

- a structured setup with its Testbench root, analyses, named outputs, and environment
  selection; or
- a raw setup with its entry path, authored files, and declared dependencies.

Projects without authored setups have an empty collection and retain their
existing circuit, hierarchy, and structural-export behavior. The setup follows the ordinary
Project save, recovery, Gallery, revision, and undo/redo boundaries; it is not
stored in a simulation-only sidecar or a second persistence service.

Schema 37 landed the optional singleton `CircuitProject.simulation`; schema 38 extends
its structured analysis union with explicit-SI transient parameters. Schema
39 adds the mutually exclusive raw input form without changing existing
Projects. Schema 40 replaces derived voltage-probe Net representatives with
concrete object anchors. It also permits an authored structured setup to remain
saved after its Testbench Cell or a probe anchor is deleted; preparation reports
that unresolved reference instead of blocking the ordinary edit or silently
rebinding intent. Schema 42 migrates that singleton to the required
`CircuitProject.simulationSetups` collection. It preserves an authored legacy
setup as `simulation-setup-1` / `Setup 1`, and migrates absence to an empty
collection. Schema 43 replaces primitive probes with named outputs and a
bounded expression AST. The 42→43 adapter wraps every old probe as an
equivalent voltage/current leaf expression and derives its initial authored
label from the Logical Net, formal Cell port, or endpoint/Instance identity.
Schema 44 makes a current expression terminal-specific. The 43→44 adapter
maps every previously supported independent-source current to its `+`
terminal, preserving ngspice's positive source-current convention.
Schema 45 adds optional authored scalar measurement rules to structured
setups. The 44→45 adapter does not invent rules; existing Projects continue
to receive only automatic summaries until an author adds a measurement.
Schema 46 adds a structured Noise request. The 45→46 adapter likewise
advances only the version: it never invents an analysis, source, or probe.

```ts
interface ProjectSimulationSetup {
  id: StableId;
  name: string;
  version: 2;
  input: SimulationStructuredInput | SimulationRawInput;
}
interface SimulationStructuredInput {
  kind: "structured";
  rootDocumentId: StableId; // the Testbench Cell, a Document of the Project
  analyses: SimulationAnalysisSpec[]; // non-empty; at most one entry per kind
  outputs: SimulationOutputSpec[]; // ids and case-folded labels unique
  measurements?: SimulationMeasurementSpec[]; // saved scalar reductions
  environment: { profileId: string; corner?: string; temperatureC?: number };
}
interface SimulationRawInput {
  kind: "raw";
  entry: string; // safe relative path naming one authored file
  files: Array<{ path: string; text: string }>;
  dependencies: Array<{
    id: string; // logical resolver identity
    mountPath: string; // relative path referenced by authored SPICE
    sha256: string; // lowercase digest of the external bytes
  }>;
  environment: { profileId: string; corner?: string; temperatureC?: number };
}
type SimulationAnalysisSpec =
  | { kind: "op" }
  | {
      kind: "dc";
      sourceInstanceId: StableId; // root Testbench independent V/I source
      startValue: number;
      stopValue: number; // must differ from startValue
      stepValue: number; // positive magnitude; direction follows start/stop
    }
  | {
      kind: "ac";
      sweep: "dec" | "oct" | "lin";
      points: number; // positive integer
      startHz: number; // > 0
      stopHz: number; // > startHz
    }
  | {
      kind: "tran";
      stepSeconds: number; // > 0, requested output interval
      stopSeconds: number; // > 0
      startSeconds?: number; // >= 0 and < stopSeconds
      maxStepSeconds?: number; // > 0, optional solver ceiling
    }
  | {
      kind: "noise";
      output: {
        positive: SimulationVoltageProbe;
        negative?: SimulationVoltageProbe;
      };
      inputSourceInstanceId: StableId; // root Testbench independent V/I source
      sweep: "dec" | "oct" | "lin";
      points: number; // positive integer
      startHz: number; // > 0
      stopHz: number; // > startHz
    };
interface SimulationVoltageProbe {
  documentId: StableId;
  anchor:
    | { kind: "terminal"; instanceId: StableId; pinName: string }
    | { kind: "junction"; junctionId: StableId }
    | { kind: "route"; routeId: StableId }
    | { kind: "base-net"; netId: StableId };
  occurrence: StableId[];
}
interface SimulationOutputSpec {
  id: StableId; // durable result/export binding
  label: string; // sole authored display name; never electrical identity
  expression: SimulationExpression;
}
type SimulationExpression =
  | {
      kind: "voltage";
      documentId: StableId;
      anchor:
        | { kind: "terminal"; instanceId: StableId; pinName: string }
        | { kind: "junction"; junctionId: StableId }
        | { kind: "route"; routeId: StableId }
        | { kind: "base-net"; netId: StableId }; // schema-39 fallback
      occurrence: StableId[];
    }
  | {
      kind: "current";
      documentId: StableId;
      instanceId: StableId;
      pinName: string; // current entering this concrete Instance terminal
      occurrence: StableId[];
    }
  | { kind: "constant"; value: number }
  | {
      kind:
        | "negate"
        | "magnitude"
        | "db20"
        | "phase"
        | "real"
        | "imaginary"
        | "absolute";
      operand: SimulationExpression;
    }
  | {
      kind: "add" | "subtract" | "multiply" | "divide";
      left: SimulationExpression;
      right: SimulationExpression;
    };
```

`occurrence` lists the hierarchy Instance ids from the root down to the
Document that owns the probed object; it is empty when that object is in the
root itself. `profileId` is the hosted Profile ID (today
`sky130-core-continuous-ngspice46-v1`). An `upsert_simulation_setup` edit refuses a
new `rootDocumentId` that names no Document of the Project. The persisted schema
allows a previously valid root or acquired object to become unresolved, while
it still rejects repeated analysis kinds, duplicate output ids/labels, and
expression trees deeper than 32 nodes. Whether the root or an acquired object
still exists is a preparation-time diagnostic, not a save
rule: an ordinary circuit edit must never make the Project unsaveable. Raw paths use one
virtual relative namespace: no absolute paths, parent traversal, Windows drive
syntax, control characters, or `.spiceinit`. The entry must be one authored
file; authored and dependency mount paths are unique. Raw authored text is
limited to 24 files and 1 MiB, matching the first-release session
workspace. External dependency bytes are not copied into the Project; logical
identity, expected digest, and required mount path make absence or substitution
explicit at preparation time.

Structured Noise uses those same hierarchy-aware voltage anchors; it does not
create a second probe or Net namespace. Preparation resolves the positive and
optional negative output nodes from the extracted design and accepts only an
independent voltage or current source owned by the Testbench root as the input
reference. One ngspice `noise` command creates `noise1` and `noise2`; the
compiler writes both plots into the canonical rawfile. Service results expose
stable `noise-output-density` and `noise-input-density` Output ids plus
integrated input/output scalars. The ngspice plot ordinals and private vector
names are execution details, not GUI or Agent protocol.

Setups are written through Project structure edits
`upsert_simulation_setup` (`{ setup: ProjectSimulationSetup }`) and
`remove_simulation_setup` (`{ setupId }`). Upsert replaces only the matching
stable ID or appends a new record; names are unique case-insensitively. Both
operate under the Project `structureRevision`, so undo/redo, Agent
`structureEdits`, and Gallery convergence treat them like any other structural
change. Deleting a referenced Testbench Cell, Route, Junction, or
terminal preserves the setup without guessing a replacement; preparation then
returns a located diagnostic until the author repairs or clears the reference.
A raw setup has no Canvas root, so unrelated Cell deletion does not affect it.

Prepared decks and bundles are transient execution data. Environment-local
model paths, run ids, receipts, logs, rawfiles, parsed results, simulator
outputs, and caches are never persisted in the Project. A raw setup's authored
source files are durable input; a prepared deck or copied execution workspace
derived from them is not. The execution resource accepts exactly two ownership
sources: `project-setup` snapshots the explicitly named `setupId` at an
expected Project structure revision; `workspace` snapshots a bounded session raw
workspace at its expected revision. These source kinds identify ownership, not
electrical syntax. Project raw dependencies that no available environment
owner can resolve produce located, recoverable preparation diagnostics; the
service never falls back to arbitrary host paths.

A raw dependency resolves only when its logical id and SHA-256 match a
dependency advertised by the selected Profile. The author chooses a safe
relative mount path; the Worker and harness validate the declaration again,
then the harness links that path to the Profile-owned, read-only model file in
the private run directory. Client-supplied absolute paths, URLs, and unverified
model substitutions are never resolution mechanisms.

A structured setup stores only a stable environment Profile ID and the
author's allowed selections such as corner and temperature. It never copies a
Profile manifest, model path, simulator digest, or measured environment
fingerprint. Preparation resolves the named Profile; execution reports the
environment that actually ran.

Preparation compiles each output expression into an immutable plan and
deduplicates its primitive voltage/current acquisitions before ngspice runs.
Arithmetic is evaluated after rawfile parsing with complex AC values preserved;
`phase` returns degrees and `db20` accepts a unitless ratio. A missing vector,
unit mismatch, or divide-by-zero invalidates only that output and returns a
structured diagnostic; other outputs and analyses remain available. OP, DC,
AC, TRAN, plots, CSV, and MCP all expose the same persisted `output.label`.
Raw simulator vector names remain technical evidence and may be shown only as
secondary detail.

The Agent helper `simulation_output` lists, upserts, and removes structured
outputs. Its bounded text grammar supports output references, constants,
`+`, `-`, `*`, `/`, `mag`, `db20`, `phase`, `real`, `imag`, and `abs`; it
parses into the same persisted AST and never executes JavaScript or forwards
arbitrary expressions to ngspice. Typed Project structure edits remain the
full-fidelity authority, so GUI and Agent operations converge on one setup
contract.

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
- `containers/ngspice/profile-contract.test.mjs` binds the Profile to the
  digest-pinned image and exact startup bytes. The Preview gate opens the
  tracked five-transistor OTA Project, compiles its persisted structured setup,
  and sends that exact prepared OP/DC/AC/TRAN request through the operator-host
  executor. It requires the Profile identity and `tt` model selection, checks
  all four compile-time output bindings, compares four OP voltages, selected DC
  transfer points, representative complex AC samples, and transient extrema
  against the recorded qualification fixture. Missing local ngspice never
  skips this hosted gate.
- The pinned local authority pack under ignored `.reference-src/` demonstrates
  that ngspice 47 completes a Sky130 NFET operating-point deck with
  `.lib ... tt`, while top-level `.include` produces repeated subcircuit
  definitions across sections.

## Inputs and root

A run has exactly one input form:

- **Structured**: a `SimulationSetup` naming a `rootDocumentId` in the
  Project, the analyses to run with their parameters, the outputs to evaluate,
  and an environment selection. The product compiles it: the design netlist
  of everything the root reaches, one instantiation of the root, the
  environment's model library, the analyses, the saves, and `.end`.
- **Raw**: an entry SPICE file and its dependency files as submitted by the
  author or an Agent. The product resolves declared dependencies and the
  environment's library mapping, and adds nothing else: no stimulus, no
  analysis, no root call, no `.control`.

Both feed the same immutable prepared input, whose identity covers the exact
file bytes, the environment selection, and, for the structured form, every
Document the root reaches plus the setup. Preparation reads the root from the
setup; a caller cannot override it with a second `rootDocumentId`. A change to
any input is a new prepared artifact; a result computed from an older input is
stale and says so.

The simulation root is the Testbench Cell chosen for the setup. It is neither
the DUT Cell nor necessarily `project.topDocumentId`, and selecting it never
changes the Project top. The DUT is an ordinary project-local subcircuit
Instance placed in that Testbench; its referenced Cell is reached through the
normal hierarchy. Extraction, diagnostics, dependency collection, occurrence
mapping, and input identity all use the same Testbench root. A deck that only
defines `.subckt`s and instantiates nothing is not a run.

### Compiling a structured setup

`compileStructuredSimulation` in `@icm/netlist` turns a setup and its Project
into the netlist and testbench halves of one request, plus an output plan and
deduplicated acquisition-to-vector bindings. The netlist half is every reached
Cell **except** the root, printed
by the same `printSpiceNetlist` the structural export uses, carrying the
`.global` declarations. The testbench half is the root's own Instances as
top-level cards, the authored `.temp` when the setup names one, and then a
`.control` block. The layout below was settled against ngspice 46, not against
the manual.

Analyses are control-block commands, not deck cards. A deck carrying both
`.op` and `.ac` and a single `run` fails: ngspice 46 answers
`doAnalyses: not found` and `run simulation(s) aborted`, exits 1, and leaves
one plot behind. Issuing `op` and `ac <sweep> <points> <start> <stop>` inside
`.control` runs both and exits 0 -- the convention the hosted smoke deck
already uses.

Each analysis is followed by its own `write out.raw <vectors>`, because
`write` saves the current plot only and truncates the file it writes. `set
appendwrite` before them keeps the earlier plot, so one rawfile holds both
back to back, which is what [Reading the rawfile](#reading-the-rawfile)
already parses. It is emitted only when there is more than one analysis, so a
single-analysis deck keeps `write`'s truncating behaviour and cannot append to
a stale file at all; a multi-analysis deck relies on the fresh per-run
directory the harness makes. The alternative -- naming the plot in the
expression, `op1.mid` -- also keeps both plots in one `write`, but ngspice
then records the variable as `v(op1.mid)`, putting a plot ordinal that depends
on how many analyses ran into every vector name. A setup with no outputs emits
a bare `write out.raw`, saving the whole plot rather than nothing.

Vector names are produced here and never inferred from result text:

| primitive acquisition              | vector                   |
| ---------------------------------- | ------------------------ |
| Net in the root                    | `v(mid)`                 |
| Net under occurrence `X1`, `XI1`   | `v(x1.xi1.mid)`          |
| terminal current in the root       | `i(vicmprb###)`          |
| terminal current under `X1`, `XI1` | `i(v.x1.xi1.vicmprb###)` |

They are lower case because ngspice folds case on the way into the rawfile: a
card may read `R1 IN MID 1k`, and `V(MidNode)` still comes back as
`v(midnode)`. A nested device carries its own type letter ahead of the
occurrence path. Net names come from the Logical-Net resolver the printer
already used, read back off the extracted Cell rather than derived a second
time.

A terminal-current output names an Instance and one of its extracted
terminals. The compiler inserts a deterministic 0 V sense source between that
terminal and its external Net, then reads the source branch current. Positive
current always means current entering the selected terminal. The same rule
therefore covers passive devices, MOS/BJT terminals, independent sources, and
Cell instance ports without depending on device- or model-specific ngspice
internal vectors. Instrumentation exists only in the prepared simulation
artifact: it does not mutate the Project or ordinary structural export. One
instrumented Cell definition remains independently addressable through every
concrete occurrence. Terminal currents are supported for OP, DC, AC, and
TRAN. The editor offers connected, emitted terminals; stale authored outputs
remain saved and preparation returns an occurrence-aware typed diagnostic
rather than silently rebinding them. The setup editor exposes the same target
set through its list and through a canvas terminal picker; a canvas pick names
the actual endpoint and preserves the Testbench occurrence instead of inferring
current from the surrounding Net. Other refusals include a missing root, a
root that instantiates nothing, an absent Instance or terminal, an invalid
occurrence, and an unsupported analysis kind.

`inputRevision` is the SHA-256 of the two compiled texts and a canonical
serialization of the setup, computed with Web Crypto so the function stays
browser-safe. `packages/netlist/src/simulation-compile.test.ts` asserts the
exact texts, every diagnostic, and byte-identical output across repeated and
re-serialized reads, then runs the divider deck through a local ngspice and
reads both plots back.

## Sources and analyses

`SimulationAnalysis` is `"op" | "dc" | "ac" | "tran"`.

- `.op` has no parameters.
- `.dc` sweeps exactly one independent voltage or current source in the
  Testbench root. Start and stop are finite and distinct; step is a positive
  magnitude, and compilation gives ngspice the sign required by the requested
  direction. It does not rewrite the source Instance's authored DC bias.
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
`waveform` parameter explicitly selects `dc`, `pulse`, or `sin`; timing fields
never select a waveform by their presence. An absent selector on a pre-contract
Project is projected from the device descriptor (`dc` for ordinary sources,
`pulse` for the existing Digital Clock) without rewriting the Project. The
Digital Clock keeps its symbol while using the same formal PULSE fields and
the same printer as ordinary voltage and current sources. Its
`dutyCycle`/`initial` convenience controls may still author the canonical
PULSE fields, but they are neither a second output authority nor emitted as
simulator assignments.

Those values are persisted only on the source Instance in the Testbench. A
Setup or Simulation UI may address and edit that Instance through the ordinary
typed Project edit path, but must not retain an override or a second copy of
its source values. Ordinary voltage and current source Properties expose the
descriptor's DC, AC, PULSE, and SIN fields directly. Switching the selected
waveform hides but retains inactive fields; only the selected waveform is
printed into the prepared deck.

The human Setup workspace authors OP, one-source linear DC, AC, and TRAN through
this same structured analysis contract. DC selects a root independent source
and shows start, stop, step, and source-derived units. TRAN exposes `tstep`,
`tstop`, and the optional `tstart` and `tmax` values in explicit seconds. Plot
views consume simulator-recorded sweep axes; they do not reconstruct an axis
from a point index or requested interval.

On the voltage-source and current-source descriptors the DC value is `dc` and
the small-signal stimulus is the optional pair `acMagnitude` (volts or
amperes) and `acPhase` (degrees). The SPICE printer emits
`DC <dc> AC <acMagnitude> <acPhase>` for a source that has a magnitude, with
the phase defaulting to `0` when it is not authored, and exactly `DC <dc>` for
a source that has none; Spectre prints the same facts as `dc=`, `mag=`, and
`phase=`. A phase authored without a magnitude has no card to ride on and is
not printed. The fields are ordinary descriptor parameters, so the Properties
panel and the Agent's `patch_instance_netlist_parameters` edit them with no
source-specific code.

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
- One process-local Run Supervisor owns admission, phase, timeout, process
  termination, result collection, cleanup, and the slot's absolute lifetime.
  If an admitted operation cannot settle inside that lifetime, the harness
  exits rather than clear the slot beside a process it cannot prove ended.
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

The process timeout is a normal terminal outcome when the group stops and
cleanup completes. A separate lease watchdog covers the entire interval from
admission through directory removal. It is not a second circuit timeout: if
it expires, the harness has lost the ability to prove the slot safe, marks
itself fatal, kills the group best-effort, and exits so the container runtime
can replace the instance. Health traffic neither extends nor resets this
deadline.

**Limits.**

| Limit             | Value                    | Enforced by                                |
| ----------------- | ------------------------ | ------------------------------------------ |
| Deck size         | 2 MiB                    | rejected `413 deck-too-large`              |
| Request body      | 4 MiB                    | connection closed, `413 request-too-large` |
| Returned output   | 1 MiB per run            | truncation, reported                       |
| Default deadline  | 30 s                     | applied when the caller names none         |
| Maximum deadline  | 120 s                    | a longer request is clamped to it          |
| Lifecycle grace   | 10 s                     | hard lease watchdog after the run deadline |
| Identity probe    | 5 s                      | given up on, not waited for                |
| Processes         | 128 (`RLIMIT_NPROC`)     | image-set `ulimit` before `exec`           |
| Written file size | 256 MiB (`RLIMIT_FSIZE`) | image-set `ulimit` before `exec`           |

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
  /** The same capped output before human-readable concatenation. */
  stdout: string;
  stderr: string;
  /** True when the log or the rawfile reached the cap. */
  truncated: boolean;
  truncatedOutputs: ("log" | "rawfile")[];
  /** What the harness observed in the submitted deck before collection. */
  rawfileRequested: boolean;
  /** The rawfile's text when the deck asked for one and it is ASCII. */
  rawfile: string | null;
  rawfileName: string | null;
  rawfileFormat: "ascii" | "binary" | null;
  /** The limits above, with the deadline this run actually got. */
  limits: Record<string, number | null>;
}
```

An authored measurement references one enabled analysis and one named Output.
It stores a stable ID, display label, and one scalar reduction: OP `value`,
`sample-at`, `minimum`, `maximum`, `peak-to-peak`, or time-weighted TRAN
`mean`/`rms`. Minimum, maximum, and peak-to-peak may use the complete analysis
or an explicit SI-domain window; mean and RMS require a time window. The rule,
not its observed number, is Project state. A Run evaluates rules after Output
expressions and returns authored rows beside separately identified automatic
summaries. A rule that is outside returned data or cannot reduce a complex
Output is locally `unavailable`; it does not fail an otherwise successful Run.

A truncated result says so rather than arriving quietly shortened, because a
shortened log read as a whole one is a wrong answer about a circuit. The
rawfile is returned when the deck contains `.save` or `write`, verbatim and
under the same cap; turning its vectors into numbers is
[Result data](#result-data) and is not done here.

`stdout` and `stderr` remain separate execution facts even though `log`
retains their human-readable concatenation. A runtime or libc failure on
stderr is not evidence that ngspice accepted a deck merely because it made
the combined log non-empty. `rawfileRequested` records the collection
decision made by the harness; the Worker independently derives the same
expectation from the prepared deck and rejects an explicit disagreement as a
protocol failure.

**Readiness.** `GET /health` answers during a run as well as between runs,
reporting the environment facts, limits, and the Run Supervisor's one
`activity` projection. It is `idle`, or it names the active phase, elapsed
time, and remaining hard-deadline time; it contains no lease id, deck, user,
or circuit data. A missing simulator binary or model tree answers `503
not-ready` rather than a success with absent facts. Health is a read-only
snapshot and never changes the run or its timers.

## Run lifecycle

The capability response does not maintain a second analysis allow-list. Its
structured `analyses` are read from the selected hosted Profile's qualified
scope; `parsedAnalyses` is reported separately because the rawfile reader may
understand results which structured preparation is not yet qualified to
author. The response also advertises the execution harness' `maxOutputBytes`.
Preparation estimates ASCII rawfile size from analysis points and compiled
probe vectors. Exceeding that estimate adds a truncation warning but never
blocks an Agent or human from starting the run.

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
a rawfile with no vectors classifies as `failed` -- reached, like every other
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

Structured evaluated outputs also carry conservative automatic measurements.
OP contributes its scalar value; DC, AC, and TRAN contribute minimum, maximum,
and span (complex AC outputs use magnitude); TRAN additionally contributes
time-weighted mean and RMS over its actual, possibly nonuniform time samples.
Each row is independently `available` or `unavailable` with a reason. A missing
crossing or insufficient sample window must not become zero and must not change
an otherwise completed Run into a failed Run. The service is the sole numerical
owner: GUI, Agent responses, and `measurements.csv` consume the same rows.

## Rollout

### Agent resource implementation

`packages/simulation-service` owns transport-neutral prepare/run lifecycle and
the canonical operation/result codecs. Its `SimulationFiles` is exposed through
the existing File Resource. Project setup and source parameters retain the
existing Project edit authority. Browser and MCP adapters do not compile their
own decks or own a second simulation model. The browser lazily creates a service
for its live Project session; opening the editor does not start ngspice.

`prepare` accepts the Project's saved setup or an isolated raw workspace. The
Project source requires `expectedStructureRevision`; there is no inline setup
that bypasses Project edit ownership. It snapshots input and publishes immutable
SHA-256-addressed artifact metadata; raw input retains its entry text and include
files. `prepared.cir` is available before execution. Structured composition uses
the executor's advertised library and the shared deck builder. The Worker rejects
a prepared deck that no longer matches its composition instead of silently using
changed deployment settings.

`start` returns a short session-local run receipt. Reusing its request ID and
payload returns the same run; a changed payload is rejected without invalidating
the session. `read` returns running/cancelling/finished/cancelled/lost and any
available evidence. A successful late completion is not relabeled cancelled.
Input-change reporting never alters frozen inputs. `cancel` requests termination
through the existing supervisor, whose process-tree cleanup still owns slot
release. A private random run token authorizes cancellation; health responses
and Agent artifacts do not expose that token. Cancel-before-admission is remembered
for the maximum run window. Network uncertainty is never an automatic rerun.
MCP transport failures return the effective request ID, including when the tool
generated it, so an Agent can retry the identical start rather than duplicate it.
File Resource `list` recovers session draft IDs after a lost create response;
it returns revision/entry/expiry metadata, not file bodies.

The browser owns its presentation receipts, not execution authority. On the
managed Preview transport, tab loss does not stop an admitted run: the owner can
list its server records, and bounded immutable input/result evidence remains in
the artifact store for one day. The queue admits at most 50 waiting runs, one
queued and one active per owner, waits at most five minutes, and dispatches only
the operator host's one declared slot. On direct/local transport, the earlier
session deadline and 15-minute File Resource retention remain unchanged.
Revoking a live browser session requests cancellation of active work and clears
its local drafts/evidence. One active session run, eight raw workspaces (24 files
/ 1 MiB each) bound local resources; expired input can be prepared again. Export returns File
Resource references for prepared/executed deck, rawfile when produced, log,
structured result, and CSV. Large read responses omit full arrays and bound the
log/diagnostic preview, explicitly setting `resultPreview`. Full evidence remains
in File Resource artifacts, read in bounded UTF-16 `offset`/`maxChars` slices
with `nextOffset`. MCP local export assembles and verifies the complete file.
Storage-capacity failures keep available evidence and return an explicit error;
they are not permission failures or proof of simulation success.

Each completed run also publishes `evidence-manifest.json`. It binds the run,
prepared digest, input revision, environment identity, probe-vector mapping,
and the names, sizes, and hashes of every preceding artifact. The manifest is
the portable inventory for the existing File Resource artifacts; it is not a
second result store and does not claim an external model tree is embedded.

The human Results view binds mappings and authored probe labels by the Run's
own `preparedId`, never by the latest Setup or most recent Prepare. Historical
numeric data remains viewable after the Project changes, while stale object
locations are refused by normal locator resolution. Direct OP Net-voltage
outputs may be painted on the exact authored anchor and concrete hierarchy
occurrence only while that input revision is current; raw node strings and
derived expressions are not guessed back to Canvas objects. AC and TRAN share
the same output browser, explicit plot tools, marker, expanded view, and
back-annotation boundary; TRAN uses a linear time axis and does not revive
Digital Simulation. The compact result export action produces standalone SVG
or PNG from the visible plot state and downloads complete numeric CSV from File
Resource artifacts, so displayed decimation is never presented as full data. A
browser session may retain a bounded set of completed structured results for
comparison; rows align only by stable output id, analysis, metric, and unit,
never by display label or array index. This first comparison view is session
state, not Project or Cloud Project persistence.

Recoverable problems use `{code,message,stage,recovery,diagnostics?}`. Ordinary
compile errors, unavailable Profiles, simulator failures and busy responses do
not end the Agent session. Only existing authorization/replacement/revocation
rules invalidate the session. There is no forced helper-only syntax, extra
approval per run, or new persistent Project schema in this increment.

Deterministic acceptance is split by boundary: shared lifecycle tests, MCP ↔
browser-host ↔ Worker tests using recorded numeric fixtures, browser WebSocket
receipt/export tests, and Linux process cancellation tests. Recorded fixtures
prove protocol/data handling, not a new electrical simulation or cloud deployment.
Real Preview qualification must use the candidate commit and declared Profile;
local tests must not be reported as that cloud acceptance.

The hosted route ships on the preview channel first (ADR 0057), where the
container is bound; production receives the binding with a promoted
release. A deployment without the binding answers
`simulation-not-configured`, a fact about the deployment.

## Deterministic validation (first release)

- Closed-form fixtures under `fixtures/ngspice-rawfile/`: a resistor divider
  operating point, an RC low-pass AC sweep, an RC step transient, and
  ngspice 46 voltage- and current-referred resistor noise results, each
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
- `scripts/preview-simulation-smoke.mjs`: the bundled five-transistor OTA
  Project is the vertical acceptance asset. Its saved `SimulationSetup` is
  parsed and compiled by the production Project/netlist packages before the
  generated OP/DC/AC/TRAN request reaches Preview. The same gate
  also runs an ideal RC pulse deck. Returned input revisions, environment
  Profile, model corner, frequency/time axes, probe series, OP values,
  selected AC complex samples, and OTA transient extrema must agree with the
  tracked ngspice 46 qualification evidence; a handwritten deck alone cannot
  satisfy this path.
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
