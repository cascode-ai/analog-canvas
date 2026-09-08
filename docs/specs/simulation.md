# Simulation Setup and Compilation

Status: accepted

Owners: `packages/model`, `packages/netlist`, `packages/simulation-service`,
`apps/editor/src/features/simulation`

Related decision: [ADR 0055](../adr/0055-simulation-is-part-of-the-product.md)

## Scope

The author owns the Testbench and analyses. Circuit Instances own stimulus and
load parameters; named Project setups own structured or raw input. Compilation
reuses the structural netlist without changing circuit facts.

This is the entry point for the simulation contract:

- This document: saved intent, roots, outputs, and compilation.
- [Execution and resources](simulation-execution.md): Profiles, preparation,
  isolation, admission, lifecycle, retention, artifacts, and qualification.
- [Numeric results](simulation-results.md): rawfiles, units, data validity,
  measurements, and CSV.
- [User workflow](../user/analog-simulation.md): authoring and results interaction.

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

The [Project file format](project-file-format.md) owns the current schema and
upgrade chain. Upgrades preserve authored intent and do not invent analyses,
measurements, device selections, or a Testbench. Setup references may become
unresolved after ordinary circuit editing; preparation diagnoses them instead
of making the Project unsaveable.

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
  deviceOperatingPoints?: Array<{
    id: StableId;
    documentId: StableId;
    instanceId: StableId;
    occurrence: StableId[];
  }>;
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

The Agent helper `simulation_setup` lists and inspects saved setups, creates a
structured setup, updates its name/root/analyses/environment without replacing
nested authored state, clones any setup, and removes a setup. It compiles to
the same Project structure edits as the GUI; full typed replacement remains
available through `advanced_transact`.

The Agent helper `simulation_output` lists, upserts, and removes structured
outputs. Its bounded text grammar supports output references, constants,
`+`, `-`, `*`, `/`, `mag`, `db20`, `phase`, `real`, `imag`, and `abs`; it
parses into the same persisted AST and never executes JavaScript or forwards
arbitrary expressions to ngspice. Typed Project structure edits remain the
full-fidelity authority, so GUI and Agent operations converge on one setup
contract.

Environment selection and run metadata follow the
[execution contract](simulation-execution.md); neither creates another Project
authority.

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
back to back, which is what [Reading the rawfile](simulation-results.md#reading-the-rawfile)
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

`SimulationAnalysis` is `"op" | "dc" | "ac" | "tran" | "noise"`.

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
- `.noise` selects a hierarchy-aware positive and optional negative voltage
  anchor, one independent voltage/current source in the Testbench root, and a
  `dec`/`oct`/`lin` frequency sweep. One user analysis owns both ngspice Noise
  plots: spectral densities use the stable output ids `noise-output-density`
  and `noise-input-density`, while integrated input/output noise are scalars.

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

## Validation

Model/setup and structured-compiler tests protect the authored boundary.
End-to-end numeric and hosted acceptance follows
[execution validation](simulation-execution.md#validation).
