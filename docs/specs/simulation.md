# Simulation Source and Compilation

Status: accepted

Owners: `packages/model`, `packages/edit-engine`, `packages/spice`,
`packages/netlist`, `packages/simulation-service`, `apps/editor`

Related decision: [Simulation rationale](../adr/simulation.md).

## Contract map

This specification owns saved source folders, source/configuration authority,
compilation, mapped edits, drafts, language assistance and Code interaction.
[Execution](simulation-execution.md) owns Profiles, admission, Run/Batch,
retention and artifact access. [Results](simulation-results.md) owns numeric
records, native measurements and Spec reports. [The user guide](../user/analog-simulation.md)
owns step-by-step operation; [deployment](../deployment.md) owns candidate acceptance.

## Authored authority

### Engine selection

The selected executor Profile determines the engine (`ngspice` or `vacask`);
there is no second persisted engine selector. Both use the same folder, mapped
edit, preparation, Run and artifact APIs. The SPICE clauses described below
apply to ngspice. VACASK uses its native language and the corresponding adapters,
not SPICE text passed unchanged into another executable.

VACASK source owns `parameters`, `include ... section=...`, native analyses,
adjacent sweeps, options, saves and Python postprocessing. Helpers and generated
Circuit text use the selected dialect. Native hierarchy is case-sensitive and
colon-qualified; ngspice vectors retain their own spelling and wrapper rules.
Synthetic export supply ports are not selectable Canvas Nets.

VACASK `prepare-sweep` applies exact execution-only points to a Project/source
copy: emitted Canvas parameters, a reachable unconditional root parameter,
the Profile-declared model section, or ambient Celsius. It never changes saved
Instances or authored bytes. Duplicate/missing targets, ambiguous declarations,
unsupported corners and conflicting temperature sweeps are repairable errors.
Prepared source maps and input identity describe the actual point; native loops
remain intact. Temperature insertion occurs before authored analyses/sweep groups
so earlier options cannot silently override the requested point.

Native device OP saves use Profile-reviewed model outputs. Terminal-current
requests use the shared derived-IR series-source transformation with deterministic
branch allocation, not guesses from MOS model drain current. Explicit save lists
are not silently widened to all vectors. Unsupported acquisitions return a
specific diagnostic; no reconstructed threshold, gm or region classifier is added.

VACASK source `dc` is mode-specific: OP evaluates the chosen waveform at time
zero unless `type="dc"`. A generated waveform that also carries `dc` produces
the informational `SIMULATION_NATIVE_SOURCE_DC_MODE` finding. Authors can switch
source mode explicitly with `alter instance("V1") type="dc"`, run bias/AC, then
restore `type="pulse"` (or the actual waveform) before TRAN. The compiler does
not emulate ngspice's independent DC/transient source semantics.

The current Project stores `simulationFolders`. Each is a version-4 source
container with stable `id`, unique editable `name`, and one `input`:

| Field             | Authority                                                                             |
| ----------------- | ------------------------------------------------------------------------------------- |
| `kind: "source"`  | Only current persisted simulation input form                                          |
| `entry`           | Authored SPICE path executed by Run                                                   |
| `configPath`      | Authored experiment JSON path                                                         |
| `files`           | Authored relative paths and exact text                                                |
| `circuitBindings` | Stable binding IDs, virtual paths, Document IDs and `subcircuit`/`top-level` emission |
| `dependencies`    | Declared dependency IDs, mount paths and SHA-256 identities                           |
| Optional `drafts` | Unapplied path/base/text buffers, optionally retaining a Circuit binding              |

The authoritative schema is
[simulation-source.ts](../../packages/model/src/schema/simulation-source.ts).
Folder edits share Project structure revision, undo/redo, Cloud Save and recovery.
Generated text, model bytes, prepared decks, run receipts and numeric results
are not additional saved folder authorities.

Paths use the safe virtual relative namespace. Authored files, generated
bindings and dependency mounts cannot share a path. Entry and configuration
are distinct author-owned paths. No host paths, traversal or startup-file
takeover are permitted. Missing Cells/files and invalid SPICE or JSON remain
saveable and produce preparation diagnostics; unsafe paths, duplicate
ownership and invalid outer Project structure are rejected.

### Native experiment configuration

New experiments use this strict minimal configuration:

```json
{
  "version": 2,
  "environment": { "profileId": "sky130-core-continuous-ngspice46-v1" }
}
```

Use the Profile advertised by the executor. SPICE owns `.param`, `.temp`,
`.lib`, analyses, `save`/`.probe`, `let`, `meas` and control loops.
They have no duplicate editable JSON fields. The valid version-2 sidecar is
hidden in the normal Explorer and file tabs but retained in complete backups.
Legacy, malformed and pending-draft configuration remains visible for repair.
Ordinary authored JSON files are not hidden.

Native loops are one program and one Run. Running selected folders creates a
bounded sequential Batch; all selected drafts are applied before preparation.
Version-2 inputs reject managed execution variants. The current analysis and
corner qualification comes from the Profile, not a GUI analysis enumeration.

### Compatibility

Project-file compatibility is owned by
[the file-format contract](project-file-format.md). Its one-way adapters convert
older structured/raw setups into source folders while preserving IDs, authored
text, effective intent and repairable references. They do not create a second
current writer or authorize server-wide rewriting.

Version-1 experiment JSON remains a supported compatibility reader. It owns
`environment`, `runPlan`, `variables`, `outputs`, `deviceOperatingPoints`,
`measurements` and `collection`. Arrays default empty, the plan defaults
nominal, and collection defaults to `out.raw`; null collection requests
log/artifact-only execution. Dependencies remain in the folder input.
The exact accepted shape stays in `SimulationExperimentConfigSchema`.

Legacy variables reference unambiguous reachable `.param` declarations and
exact parameter targets; nominal values remain native text. Prepared projection
uses descriptor units/scaling with nominal, variable-point, then exact-parameter
axis precedence. A temperature axis replaces the nominal declaration for that
prepared member. No projection rewrites saved Instance values.

Legacy acquisitions carry `circuit: { bindingId, callPath }` plus the existing
Document/object/occurrence address. `callPath` contains authored X-instance
names, resolved case-insensitively against captured input; it is empty for a
top-level binding. Two DUT calls cannot silently share a probe. Stale or
ambiguous calls receive diagnostics. Native vector leaves carry no invented
Canvas mapping. Legacy terminal-current sense sources remain prepared-only
instrumentation; new native helpers do not author that configuration.

Helper can explicitly convert a simple legacy sidecar when its collector
matches and no advanced intent needs translation. Remaining bindings, sweep
plans, outputs, OP selections, measurements or corners block conversion with
an explanation. Arbitrary advanced legacy translation is not implemented.
Preserving these inputs does not promise regeneration of retired evaluated
outputs or charts; current and historical result behavior is defined in
[results](simulation-results.md#historical-output-compatibility).

## Canvas compilation

`compileNgspiceSourceSimulation` and `prepareSourceExecutionInput` consume one
Project/folder snapshot and reuse electrical extraction and the ordinary printer.
The native `compileSourceSimulation` uses the VACASK printer instead.

The selected simulation Profile never remaps the Canvas circuit before that
extraction. Preview/copy/export and simulation therefore share model or
subcircuit identity, invocation kind, references, parameters and connectivity.
Simulation may add source-owned includes, analyses and acquisition
instrumentation after extraction, but the generated Canvas circuit remains the
same canonical electrical IR.

- `subcircuit` emits the bound Cell and its dependency closure as definitions;
  authored text owns DUT calls, stimuli and loads.
- `top-level` emits the selected Cell's root cards and reached definitions.
  There is at most one such binding. Root formal defaults become `.param`.
- A text-only experiment needs no Canvas binding.
- Neither form changes `project.topDocumentId`, invents sources, or inserts
  another root call. Overlapping closures must not duplicate definitions.

Generated topology, interfaces, model identity and Instance parameters remain
Canvas-owned. Generated text and editable spans are derived. A fully textual
experiment owns its own topology. Known shadow definitions of generated Cells
and deliberate replacement of their topology are preparation errors.
Parameter `alter` remains authored control, not an alternate Canvas edit.

Composition resolves safe dependencies and includes while retaining authored
bytes and source maps. Opaque control and repeated includes retain native
meaning; the structural importer's projection is not an execution rewriter.
Unknown static syntax alone cannot block native execution, though Profile,
authorization, path and actual capacity constraints still apply.

### Mapped parameter edits

The printer exposes exact object/parameter targets, original values, descriptors,
unit conversions and a generation digest. Editable spans are never persisted.

- Supported spans include reversibly printed dimensions/multiplicity and R/C/L
  values. V/I bodies support DC, AC magnitude/phase and complete PULSE/SIN/PWL
  clauses, including clause removal through ordinary unset edits.
- Numeric literals and braced or single-quoted parameter expressions use the
  same mappings. Reviewed SKY130 Code dimensions use micrometres and Canvas
  dimensions use metres; conversion survives expression round trips.
- Nodes, pin order, references, device class, model identity and unsupported
  fields remain locked. Descriptor membership alone does not prove reversibility.
- One paste applies all valid mapped edits atomically or none. Changes to locked
  structure refuse the whole paste. Stale generated digests/revisions require
  rereading; old spans never target a changed circuit.
- Definition edits affect every occurrence/experiment sharing that Cell.
  Experiment-only changes belong in source; legacy variants use prepared copies.
- Missing optional source clauses are display guidance, never saved defaults.

Drawn V/I sources own their typed `dc`, `acMagnitude`, `acPhase` and explicit
`waveform` parameters. AC and transient intent coexist. Phase alone is not
emitted without magnitude. VDD/GND and labels are connectivity markers, not
energy sources. Model/dialect rules remain in [netlist export](netlist-export.md).

## Files, drafts and concurrency

The common File Resource supports both Project-folder and private
session-workspace ownership. They share codecs, not lifetime; session expiry
cannot delete Project source. Session text has no implicit live Canvas binding.

A Project file batch has an expected structure revision and one history entry.
Range patches use expected text digests and half-open UTF-16 offsets. Reject
stale, overlapping or invalid ranges atomically; preserve comments and line
endings. Rename composes remove/write/reference edits in one transaction.

GUI typing uses local drafts and editor undo. Committed updates use Project
undo. Flush/reload establishes their boundary, including Agent writes.
A revision-valid Agent update can commit while a dirty GUI draft remains;
that older draft becomes conflicted and cannot silently overwrite the update.

Save source applies the current folder's pending files locally without a cloud
request. Run applies drafts before capture; File Save/Export and Check and Save
capture the same source state. Invalid authored syntax can be committed as text.
Unapplied generated-parameter edits are saved as explicit `input.drafts` when
necessary, without changing Instance values. Preparation refuses unresolved
buffers instead of executing old values. Successful application or explicit
discard clears the buffer. Recovery/save/reload retain unfinished work.

## Capture and result identity

Native helpers author visible `save`, `.probe`, model-vector and measurement
commands. Top-level terminal selection uses native `.probe`; hierarchical
selection supports model-native readable drain and voltage-source branch
currents. Unsupported internal terminals produce a limitation without modifying
the Project. Helpers do not infer currents from arbitrary `i(m1)` spellings,
add hidden sense sources for native inputs, or widen explicit saves to `all`.

One Run collects at most one ASCII rawfile. Version 2 derives its path from
reachable literal `write` commands; repeated writes to one path can use
`appendwrite`. Dynamic or multiple distinct paths are diagnosed. No write
means log/artifact-only execution. Version 1 retains its explicit collector.
Compiler, Worker and harness must agree on capture intent.

Templates use a fresh run directory, ASCII and appendwrite, and capture after
each analysis. Noise templates capture both density and integrated records.
There is no hidden final write that recovers all previous analyses. Ambiguous
helper insertion is refused with a repair location; missing captures are not
silently repaired.

Input identity covers authored/config bytes, generated electrical content,
bindings, dependencies, Profile and effective legacy projections. Results keep
their captured input and mappings. Editing live source makes evidence stale;
it never recomputes an old verdict or rebinds old numbers.

[Results](simulation-results.md) owns raw record ordinals, units, bounded Noise
pairing, native scalar reports and `* @spec` evaluation. New runs expose raw
numeric data and Specs rather than a second waveform evaluator. The GUI offers
Specs and Console; external consumers plot raw/CSV. Existing archive fields
remain readable. Artifact export grants no live writeback and does not bundle
restricted model libraries.

## Language assistance

One `packages/spice` catalog supplies completion, signatures, hover, templates
and local checks to GUI and Agent. Rules retain language context and cited
evidence. Circuit dot-cards, control commands, `.param` and B-source expressions
are distinct contexts; the bounded structural evaluator is not a universal
ngspice grammar.

Coverage includes comments/continuation/numbers, includes and hierarchy,
parameters/functions, RLC and source cards, OP/DC/AC/TRAN/Noise, and common
control/acquisition commands. Valid opaque native syntax remains executable
subject to environment policy. Path-policy refusal is not a syntax error.

Located diagnostics retain `scope` (`authored`, `generated`, `prepared`),
path, text digest, UTF-16 offsets and one-based line/column, alongside an
ObjectLocator where applicable. Navigation must not apply old ranges to new
text. Input errors affect preparation, not saving or the Agent session.

### Language references

The baseline follows the declared
[hosted Profile](../../containers/ngspice/hosted-sky130-profile.json).
For its ngspice 46 language evidence, use the
[fixed manual](https://ngspice.sourceforge.io/docs/ngspice-46-manual.pdf),
[official source](https://sourceforge.net/projects/ngspice/files/ng-spice-rework/old-releases/46/ngspice-46.tar.gz/download)
and [document source](https://sourceforge.net/projects/ngspice/files/ng-spice-rework/old-releases/46/ngspice-doc-46.tar.gz/download).
Manual sections 2, 3–5, 11–13 distinguish syntax, device, analysis and control
contexts. Frontend `inpcom.c`, `subckt.c`, `numparam/`, control/command parsers
and `src/spicelib/parser/` are implementation references, not one grammar.

Recorded local SHA-256 identities, not upstream signatures:

```text
ngspice-46-manual.pdf
b5bc7c4f3aac00e670b01b1d1ab64ec87055a491014af1de828764bf98faf766
ngspice-46.tar.gz
a0d1699af1940b06649276dcd6ff5a566c8c0cad01b2f7b5e99dedbb4d64c19b
ngspice-doc-46.tar.gz
6179b56c48bbe08a7e60775b629492df6b4182acafbf1b25c2c8cd78bea13e47
```

Reference archives are optional research inputs, not product build dependencies.
Preserve notices; do not ship full manuals/model data inside the editor.
Language examples are not automatically qualified electrical fixtures.

## Workspace interaction

Simulation is a lazy, independent right workspace beside Properties. Opening
the editor does not load Code or start ngspice. Resize/minimize retains drafts,
run ownership and editor state; maximize/restore retains the previous split.
Closing presentation does not cancel execution.

Explorer shows source paths directly under each experiment. Only the initial
active folder expands; temporary Run groups start collapsed. Results/raw/CSV
and Logs are normal output entries; preparation/evidence remain accessible via
diagnostic export. File Resource retains full artifact access.

Folder activation, expansion, batch selection, open editors and keyboard focus
are separate state. Clicking a folder name or opening its source file activates
it for Run; its chevron only expands. Context-menu and modifier selection do not
retarget execution. The Run control names its active folder; viewing another
file inside it never changes the explicit entry. Closing tabs deletes no source
and does not change entry. Folder switches preserve tabs, drafts and caret state.

Set up manually and New experiment create a named current-Cell OP starter.
They do not create a Testbench or infer stimuli. Helper insertion changes text
only through explicit action. Helper and Ctrl+Space share the catalog; picking
can add successive signals until Done/Escape without forcing focus changes.

File/folder commands use one portalled context menu with keyboard navigation,
outside-click dismissal and explicit targets. Inline new/rename accepts once
on Enter/valid blur and cancels on Escape/empty blur. Delete uses a small
confirmation with Cancel initially focused. Multi-file download preserves paths.
Explorer and pane widths are local preferences, not Project fields.

Keyboard, IME, paste and undo follow code focus; Canvas shortcuts cannot delete
schematic objects while typing. Source Save and Cloud Save remain distinct.
Specs/Console, archives and exports use the existing service and input snapshots;
updates do not open panels or steal focus from humans when an Agent runs.

## Valid and rejected examples

A minimal unbound input uses the version-2 configuration above, no bindings or
dependencies, and this authored entry (syntax example, not qualification):

```spice
* Divider
V1 in 0 DC 1
R1 in out 1k
R2 out 0 1k
.control
set filetype=ascii
set appendwrite
op
write out.raw
.endc
.end
```

An atomic paste changing two exposed MOS dimensions is valid. A paste also
changing a drain node is refused without partial mutation. An incomplete
authored `ac dec` can be saved and repaired; it is not replaced with the last
executable program. Missing source references remain located preparation errors.

## Deterministic validation

Schema/migration and File Resource tests protect ownership, revisions, drafts
and compatibility. Compiler tests protect reversible parameters, scaling,
hierarchy, exact bytes and capture. Browser tests protect interaction, keyboard
isolation and retained state. Rawfile/service tests protect evidence and Specs.

Real GUI, public MCP and cross-Project journeys require candidate-specific
evidence separate from mocked regression tests. Electrical acceptance names the
simulator, models, corner and declared numerical criteria. Test existence or
mocked success does not qualify another candidate. The
[test contract matrix](../testing/contract-matrix.md) owns validation layers;
[deployment](../deployment.md) owns the Production verification route.
