# Simulation Source and Compilation

Status: accepted

Owners: `packages/model`, `packages/edit-engine`, `packages/spice`,
`packages/netlist`, `packages/simulation-service`, `apps/editor`

Related decision: [Simulation rationale](../adr/simulation.md).

## Contract map

This spec owns saved source folders, compilation, mapped edits, drafts,
language assistance and Code interaction. [Execution](simulation-execution.md)
owns Profiles, admission, runs and artifacts; [results](simulation-results.md)
owns numeric records and Spec reports. The Worker prepares saved folders the
same way for Gallery [simulation checks](community-gallery.md#simulation-checks).

## Authored authority

### Saved folder

`project.simulationFolders` holds version-4 source containers (`id`, unique
`name`, `input` with `kind: "source"`, `entry`, `configPath`, `files`,
`circuitBindings`, `dependencies`, optional `drafts`), defined in
[simulation-source.ts](../../packages/model/src/schema/simulation-source.ts).

- Folder edits share structure revision, undo, Cloud Save and recovery.
  Generated text, model bytes, prepared decks, receipts and results are never
  saved authorities.
- Paths are safe virtual relative paths (no host paths, traversal or
  startup-file takeover); authored files, bindings and dependency mounts never
  share a path; entry and config are distinct.
- Missing Cells/files and invalid SPICE/JSON stay saveable as preparation
  diagnostics; unsafe paths, duplicate ownership and invalid Project structure
  are rejected.

### Engine selection

- The executor Profile decides the engine (`ngspice` or `vacask`); there is no
  second selector. Both share folder, edit, preparation, Run and artifact APIs.
- VACASK runs its native language, never SPICE passed through; its source owns
  `parameters`, `include ... section=...`, analyses, sweeps, options, saves and
  Python postprocessing. Native hierarchy is case-sensitive and colon-qualified.
  Synthetic export supply ports are not selectable Canvas Nets.
- VACASK source `dc` is mode-specific (OP evaluates the waveform at t=0 unless
  `type="dc"`); a generated waveform also carrying `dc` yields informational
  `SIMULATION_NATIVE_SOURCE_DC_MODE`. ngspice DC/transient semantics are not
  emulated.
- Device OP saves use Profile-reviewed outputs; terminal currents use the shared
  derived-IR series-source transformation. Explicit saves are never widened;
  unsupported acquisitions get a specific diagnostic, never a reconstructed
  threshold, gm or region.

### Shared external implementations

- Project `modelSources` resolve through the design-export inventory; each
  reachable owner and helper closure emits once after includes and sections
  expand. Folders and generated names never shadow owned definitions.
- VACASK projects only applied SPICE R/C/L, independent sources, linear E/G/F/H
  and X calls within the owned closure (ordered ports, scalar formals). Native
  Spectre passes strict SPICE conversion first and never runs as Spectre. SPICE
  names keep case-insensitive identity in VACASK.
- The VACASK projection refuses before execution with a source-owner
  diagnostic: opaque/B sources, model cards, `.param`, `.global`, functions,
  conditionals, external library loads, undeclared helper calls, formal `m` without forwarding, placeholders.
  Static Apply stays less strict than execution.
- DC/AC/PULSE/SIN/PWL clauses enter the canonical waveform contract; an
  explicit DC bias differing from the waveform's initial value refuses.
- Model dependencies merge by identity, path and digest and must match the
  Profile; corners change only prepared load tokens. Source maps keep owner ID,
  revision and offsets; converted cards navigate to native owners but are not
  reverse-editable. Receipts archive `model-sources.json`.
- Applied edits change input identity; draft-only saves keep executable bytes
  (with a warning). Model drafts never block an applied snapshot; invalid
  experiment/control drafts do. Circuit File Resource body/default edits use
  Manager's atomic Apply; interface edits refuse with owner navigation.

### Native experiment configuration

New experiments use `{ "version": 2, "environment": { "profileId": "<id>" } }`.
Without a named Profile the create takes:

1. the single Profile whose `devices` and `cellLibraries` cover every reviewed
   PDK device and standard cell bound in the Cell and its sub-Cells. Gates must
   match their library and its exact `masters` list when advertised;
2. else the single Profile covering all once its library's high-voltage DMOS
   count as qualified (SKY130 ngspice runs 16 V and 20 V devices unlisted).

Ideal blocks, the generic diode and authored models never count; a Profile
listing neither devices nor cell libraries is never default. With several or none, the author names
one; Agent `simulation_folder` create refuses with `SIMULATION_PROFILE_REQUIRED`
and the candidates. The GUI form mirrors this call and falls back to the VACASK
candidate only offline.

The top is always a testbench: a Cell with pins is a DUT called as `XDUT` from a
new `testbench.spice` (ports in export order, clock phase pins included, bound as
subcircuit); a Cell without pins is the testbench itself (top-level, unprefixed
nodes); `dut` wraps either.

SPICE owns `.param`, `.temp`, `.lib`, analyses, `save`/`.probe`, `let`, `meas`
and loops; JSON never duplicates them. A valid version-2 sidecar is hidden in
Explorer but kept in backups; legacy, malformed or draft-pending config stays
visible.

### Runs and sweeps

- Native loops are one program and one Run; running several folders makes a
  sequential Batch after applying their drafts.
- `prepare-sweep` projects execution-only points (Profile model section,
  ambient temperature, one unconditional root parameter, an emitted Instance
  parameter) onto immutable prepared copies, never saved Instances or bytes.
  Duplicate, missing, ambiguous or conditional targets, unsupported corners and
  conflicting temperatures are repairable errors. Temperature is inserted before
  authored analyses. Qualification comes from the Profile.

### Compatibility

[The file-format contract](project-file-format.md) converts older setups into
source folders one way, preserving IDs, text and repairable references.

- Version-1 JSON (`SimulationExperimentConfigSchema`) stays readable:
  `environment`, `runPlan`, `variables`, `outputs`, `deviceOperatingPoints`,
  `measurements`, `collection` (arrays default empty, plan nominal, collection
  `out.raw`, null meaning log-only).
- Legacy variables bind unambiguous `.param` targets; axis precedence is
  nominal, variable point, exact parameter; temperature replaces the nominal
  declaration; saved Instances are never rewritten.
- Legacy acquisitions carry `circuit: { bindingId, callPath }` (authored X names,
  case-insensitive, empty at top level); two DUT calls never share a probe.
- Helper converts only simple sidecars with a matching collector and no advanced
  intent; retired outputs are not regenerated
  ([results](simulation-results.md#historical-output-compatibility)).

## Canvas compilation

`compileNgspiceSourceSimulation`/`prepareSourceExecutionInput` and VACASK
`compileSourceSimulation` consume one snapshot and reuse electrical extraction.

- The Profile never remaps the circuit, so preview, export and simulation share
  identity, invocation, parameters and connectivity; simulation only adds
  includes, analyses and instrumentation.
- `subcircuit` bindings emit the Cell closure as definitions (authored text owns
  DUT calls and stimuli); `top-level` (at most one) emits root cards with formal
  defaults as `.param`. Neither changes `project.topDocumentId`, invents sources
  or duplicates definitions.
- Shadowing or replacing a generated Cell's topology is a preparation error;
  `alter` is authored control. Composition keeps authored bytes and native
  meaning; unknown static syntax alone never blocks execution.

### Mapped parameter edits

The printer exposes exact targets, original values, descriptors, unit
conversions and a generation digest; spans are never persisted.

- Editable: reversible dimensions/multiplicity, R/C/L values, V/I DC, AC
  magnitude/phase and full PULSE/SIN/PWL clauses (unset removes). SKY130 Code
  dimensions are µm, Canvas metres. Locked: nodes, pin order, references, device
  class, model identity, unsupported fields.
- A paste applies atomically or not at all; any locked change refuses it; stale
  digests require rereading. Definition edits affect every sharing occurrence.
  Missing optional clauses are never saved defaults.
- Drawn V/I sources own `dc`, `acMagnitude`, `acPhase`, `waveform`; phase never
  emits without magnitude. VDD/GND and labels are markers, not sources.

## Files, drafts and concurrency

- Project-folder and session File Resources share codecs, not lifetime.
- A file batch carries an expected structure revision (one history entry); range
  patches use text digests and half-open UTF-16 offsets and reject atomically.
- GUI drafts use editor undo; committed updates use Project undo. A valid Agent
  update over a dirty GUI draft marks the draft conflicted.
- Save source applies locally without a cloud request; Run, Save/Export and
  Check and Save capture the same applied state. Unapplied generated-parameter
  edits persist as `input.drafts`; preparation refuses unresolved buffers.

## Capture and result identity

- Helpers author visible `save`, `.probe`, vector and measurement commands; no
  inference from `i(m1)`, hidden sense sources or `all`.
- One Run collects at most one ASCII rawfile, its path from literal `write`
  commands (`appendwrite` for repeats); dynamic or multiple paths are diagnosed;
  none means log-only. Templates capture after each analysis; there is no hidden
  final write.
- Input identity covers authored and generated content, bindings, dependencies,
  Profile and legacy projections. Source edits make evidence stale, never
  recomputed.

## Language assistance

- One `packages/spice` catalog serves GUI and Agent; dot-cards, control,
  `.param` and B-source expressions are separate contexts; valid opaque syntax
  stays executable.
- Diagnostics carry `scope` (`authored`, `generated`, `prepared`), path, digest,
  UTF-16 offsets, line/column and an ObjectLocator when applicable; old ranges
  never apply to new text; errors block preparation, not saving.
- Evidence follows the [hosted Profile](../../containers/ngspice/hosted-sky130-profile.json)
  and ngspice 46 sources (research inputs, never shipped). Recorded local
  SHA-256: manual
  `b5bc7c4f3aac00e670b01b1d1ab64ec87055a491014af1de828764bf98faf766`, source
  `a0d1699af1940b06649276dcd6ff5a566c8c0cad01b2f7b5e99dedbb4d64c19b`, docs
  `6179b56c48bbe08a7e60775b629492df6b4182acafbf1b25c2c8cd78bea13e47`.

## Workspace interaction

- Simulation is a lazy right workspace; opening the editor loads neither Code
  nor a simulator; resizing or closing keeps drafts and runs.
- Activation, expansion, batch selection, open editors and focus are separate.
  Clicking a folder name or opening its source activates it for Run; chevrons
  only expand; menus and modifiers never retarget Run; closing tabs deletes
  nothing.
- New experiment creates a current-Cell OP starter; helpers edit text only on
  explicit action.
- Code focus owns keys, IME, paste and undo; Canvas shortcuts never fire while
  typing. Source Save and Cloud Save differ. Agent updates never open panels or
  steal focus.

## Deterministic validation

Electrical acceptance names simulator, models, corner and criteria; mocked
success qualifies nothing. The [test contract matrix](../testing/contract-matrix.md)
owns layers; [deployment](../deployment.md) owns Production verification.
