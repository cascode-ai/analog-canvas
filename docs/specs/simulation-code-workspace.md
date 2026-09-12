# Simulation Code Workspace

Status: accepted

Delivery: source-input Code workspace implemented and layout approved; Preview
only. Full delivery and the two live acceptance journeys gate mainline delivery.

Owners: `packages/model` / `packages/edit-engine` (saved input and edits),
`packages/spice` / `packages/netlist` (language and compilation),
`packages/simulation-service` / Agent adapters (resources), `apps/editor` (dock).

Related decision: [ADR 0055](../adr/0055-simulation-is-part-of-the-product.md).

## Applicability

This is the source-authoring contract. [Simulation Folders and Compilation](simulation.md)
describes its integration with the existing electrical compiler and device facts.
Production promotion is a separate release decision.
The execution and numeric contracts remain in
[execution](simulation-execution.md) and [results](simulation-results.md).
Only the changes explicitly identified here amend those boundaries.

The goal is ordinary Canvas editing plus a right-hand code dock, with a unified
Explorer beside code and flat Console/Plot/OP/Compare tabs beneath it. It is not
a general IDE, a second circuit model, a new executor, or unrestricted remote
shell access. Timing/Digital Simulation,
new model qualification, live cross-Project libraries, and Production promotion
are outside this work.

## 1. One owner for each fact

### Native Code authority (configuration version 2)

New experiments use a strict minimal sidecar:

```json
{ "version": 2, "environment": { "profileId": "hosted-sky130-v1" } }
```

The profile ID above is illustrative; use the ID advertised by the executor.
SPICE owns `.param`, parameter references, `.temp`, `.lib` selection, analyses,
`save`/`.probe`, `let`, `meas`, and control loops. None has an editable JSON
counterpart. Generated Circuit parameter slots accept numeric literals or braced
and single-quoted parameter expressions. They still map back to the same Canvas
Instance through one transaction; topology remains protected. Reviewed SKY130
Code dimensions are in micrometres and Canvas dimensions in metres; expression
wrappers explicitly preserve that conversion, including round trips.

Batch is a queue of selected experiment folders, invoked by **Run selected
folders** in the Explorer context menu. All selected folders' drafts are applied
before preparation, not just the active folder. Native loops remain one native
program, not an app-expanded sweep. Execution variants are rejected for version 2.

Device OP is derived from vectors actually collected by Code. `op` takes no
parameters: request e.g. `save @m1[id] @m1[gm]`, then `op`, then `write result.raw`.
Helper resolves Canvas and authored hierarchy identities, including reviewed
SKY130 wrapper primitives. It never adds JSON selections or hidden Canvas sense
sources. Top-level terminal picks use native `.probe`; hierarchical picks support
only model-native readable drain currents and voltage-source branch currents.
Unsupported internal terminals report the limitation without modifying the project.
Native raw names and model values remain evidence; there is no reconstructed
`gm`, threshold or saturation-region algorithm.

Native `meas` results are finite scalar reports read from the simulator log, with
report order and Console line retained. Missing results are unavailable, not zero.
Repeated names are not guessed to belong to particular raw plots, and units are
not inferred. Existing automatic result summaries remain app-derived views.

The one-rawfile executor derives its collector from reachable literal `write`
paths. Repeated writes may use one path with `set appendwrite`; dynamic paths and
multiple distinct paths are diagnosed. No `write` means a console/artifact-only
run, not an invented `out.raw`. The profile and safe dependency manifests remain
application responsibilities; an explicit native `.lib` selects its corner.

Version-1 experiments are a **legacy compatibility lane**, not Code-only
experiments. They retain their original JSON behavior and show a visible legacy
notice. Helper can explicitly convert sidecars with no remaining advanced intent
and a matching collector. Bindings, sweep plans, named outputs, Device OP selections,
measurements and corners that need translation block that conversion and list the
required work; no intent is silently erased. Automated translation of arbitrary
legacy advanced experiments is not implemented. The version-1 descriptions below
document that compatibility lane only and do not authorize new sidecar features.

| Fact                                                                  | Authority                                | Permitted editor                                              |
| --------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------- |
| Canvas circuit topology, interfaces, model/device identity            | Existing Project Cells and Instances     | Existing Project edits                                        |
| Persistent circuit dimensions and exposed instance values             | Instance netlist parameters              | Properties or mapped code edits, through the same transaction |
| Text-authored Testbench, sources, loads, analyses and control flow    | Authored SPICE files                     | Human, Agent, template or helper                              |
| Drawn Testbench topology and source values                            | Its ordinary Cell                        | Canvas/Properties or mapped parameter edits                   |
| Runtime Profile ID                                                  | Authored minimal experiment configuration | Human or Agent                                                |
| Variables, acquisition, analysis, loops and native measurements       | Authored SPICE (version 2)                | Human, Agent or Helper                                        |
| Generated text, ASTs, effective parameters and object/vector mappings | Derived from one captured input          | Read-only projections                                         |
| Prepared artifacts, run state and results                             | Existing simulation service and executor | Existing lifecycle and artifact resources                     |

No hidden `analyses[]`, source overrides, form state or second parsed JSON
object is persisted beside the text as another editable authority. A drawn TB
is not also copied into editable TB text. A completely text-authored experiment
has no Canvas binding and may freely edit its own topology.

## 2. Saved input and virtual files

`Project.simulationFolders` is the sole saved source-container collection.
Each folder has a stable `id`/`name`, explicit entry and the existing
create/clone/delete/save/recovery/undo semantics. There is no separate Setup
selector or settings object. All new input uses one form:

```ts
interface ProjectSimulationFolder {
  id: StableId;
  name: string;
  version: 4;
  input: {
    kind: "source";
    entry: string; // authored SPICE path; explicit Run target
    configPath: string; // authored JSON path, normally experiment.json
    files: Array<{ path: string; text: string }>;
    circuitBindings: Array<{
      id: StableId;
      path: string; // generated virtual file; not also present in files
      documentId: StableId;
      emission: "subcircuit" | "top-level";
    }>;
    dependencies: Array<{ id: string; mountPath: string; sha256: string }>;
  };
}
```

Version 4 is the source-input format in Project schema 50. The existing upgrader
performs the source migration and a one-way schema-49 collection rename, preserving
IDs and exact files. Older data is read only at that compatibility boundary.

- `subcircuit` emits the bound Cell and its closure as definitions, with the
  normal printer's interface order. Author text owns the actual DUT call(s).
- `top-level` emits an already drawn TB's root cards and reached definitions.
  There is at most one top-level binding. Preparation adds neither a second
  root call nor guessed sources. Neither mode changes `project.topDocumentId`.
- A binding does not store generated bytes or instance parameter values. Shared
  definitions use the existing deterministic extraction and naming rules;
  overlapping closures must not emit duplicate definitions.
- Paths use the existing safe virtual relative namespace. Authored paths,
  generated paths and dependency mounts cannot collide. No host paths, URLs,
  traversal, or startup-file takeover become available through File Resource.
- Missing Cells, files or references are repairable preparation diagnostics.
  Text containing invalid SPICE or JSON remains saveable. Path safety, unique
  ownership, size limits and valid outer Project structure are still enforced.
- Project source uses the existing Project size/capacity boundary; conversion
  must not reject a previously valid setup merely because configuration is now
  text. Session workspaces retain their existing 24-file/1-MiB/TTL limits.
  Execution size limits remain independent: oversized saved intent can receive
  a recoverable preparation refusal without preventing Project saving.
- Deleting or renaming a referenced file is allowed atomically with repairs;
  otherwise retain the now-unresolved entry/reference for diagnosis. Deleting
  a binding is explicit, not a side effect of editing its displayed filename.

New experiments ask for a name and an explicit Cell selection, defaulting to the
current Canvas Cell. They bind the selected Cell as the top-level circuit and
create a small `op` starter; they do not ask for OP/AC/TRAN or TB/DUT/source mode.
Any Cell can be the simulation root, not only a dedicated Testbench. The Explorer
shows the bound Cell name (or a missing-Cell marker) in a non-focusing folder
hover hint, not inline beside the folder name; changing the active Canvas
does not rebind an existing experiment. The existing circuit binding is the sole
source mapping, with no duplicate Cell setting in `experiment.json`. Creation
does not wrap the Cell in an invented DUT call or guess stimuli. Helpers can
insert AC, TRAN and DC commands without making another form
state authoritative; the editor has no permanent analysis-example footer. The source API
retains text-only and text-DUT creation for import, Agent and compatibility flows,
but those are not choices in the normal new-experiment interaction. No starter
creates a TB Cell or guesses stimuli.
The empty workspace uses the top **Set up** action. Explorer also keeps a permanent
**New experiment** command; file and folder context commands remain available with
Shift+F10. Archive and Export share the output tab bar with Console/Plot/OP.
Existing experiments reopen unchanged; duplication is an explicit action.
`circuit.spice`, `testbench.spice`, and `run.cir` are conventions, not mandatory
file counts. A drawn TB does not need an additional authored TB file.

The flat **Helper** list and Ctrl+Space share the ngspice help catalog. The
Helper button stays fixed at the right of the open-file tab row.
Helper and signal selection use the same anchored popup footprint without resizing
the editor. Closing by clicking outside preserves focus at the clicked destination.
Search accepts command names and purpose keywords; contextual typing completion is
limited to commands and relevant arguments, not comments or arbitrary text.
Argument completion opens after the space in `save`/`dc`; native vector names stay
unchanged. Candidate selection and hover can locate mapped Canvas Nets through
the same derived naming traversal. Text-only signals remain usable without a
Canvas target.
An unknown command offers a quiet Helper hint instead of opening a large list.
Choosing a command inserts its name and presents missing arguments as display-only
ghosts. Tab/Shift+Tab navigate arguments, Escape dismisses guidance, and no ghost
or implicit default enters saved/exported/executed text. Parameter guidance is
advisory: users and Agents may continue writing native syntax beyond the catalog.
Parameter descriptions remain visible without a permanent Tab/Shift+Tab legend.

Helper signal actions insert native `save`/`.save` statements, not a parallel
voltage-output configuration. Signal selection stays open for successive additions;
added choices are marked and cannot insert duplicates within that selection session.
Canvas picking continues until Done or Escape. Successive picks extend the session's
save statement without focusing the editor; the file row exposes picking status
and Done. Failed additions keep the selection available and report their cause.
Terminal-current picks write native `.probe` or a model-native `save` vector.
They never create new legacy configuration instrumentation or silently widen
an explicit save list to `all`.
Discovery and completion use the compiler's authored call-path mapping; they
show the Canvas name alongside the executable native vector. Native vectors
remain available for text-only or statically unresolvable scopes.
Valid version-2 `experiment.json` is internal hosted-environment metadata, hidden
from the Explorer and file tabs. It remains in Project persistence and complete
backups. Legacy, malformed and pending-draft configuration remains visible for
repair; ordinary authored JSON files are not hidden. No environment picker is
provided in the normal Code workspace.

Folder expansion is independent of active execution and batch selection. New
files/folders and renames use inline text input (Enter accepts, Escape cancels),
not browser prompts or an obligatory analysis/TB questionnaire. A new file is
ordinary authored text; entry/includes determine whether it executes. Optional
Canvas templates produce protected generated bindings, not a writable copy of
the circuit. All persistence still uses the shared folder/file operations.

### Legacy experiment configuration (version 1 only)

The JSON text at `configPath` is the sole configuration authority. Its version-1
object has these fields; bounded leaves reuse the existing model schemas:

| Field                   | Meaning                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| `version: 1`            | Configuration format, not simulator version                                                        |
| `environment`           | Existing Profile ID and optional corner; no copied manifest, binary path, or nominal temperature   |
| `runPlan`               | Existing nominal/sweep plan, including corner, temperature, variable and exact-parameter axes      |
| `variables`             | `{id, name, sourcePath, bindings}`; existing exact-target parameter bindings, **no nominal value** |
| `outputs`               | Existing stable output IDs, labels and expression AST; acquisition addressing below                |
| `deviceOperatingPoints` | Existing device selections with explicit circuit scope below                                       |
| `measurements`          | Existing `SimulationMeasurementSpec[]` and evaluator                                               |
| `collection`            | `{ rawfile: string \| null }`; default `out.raw`, null explicitly requests artifacts/logs only     |

Arrays default to empty, `runPlan` to nominal and `collection.rawfile` to
`out.raw`; helpers write those defaults explicitly. `environment.profileId` is
required to prepare. Unknown configuration fields are diagnosed, not silently
used as simulator options. Malformed configuration text can still be saved.
Dependencies remain only in `input.dependencies`, not duplicated in this JSON.

Nominal temperature belongs to authored `.temp`; waveform and analysis values
belong to SPICE. Configuration must not grow fields that repeat those values.
One variable identifies an unambiguous top-level `.param` declaration in the
reachable `sourcePath`. Its nominal expression remains there. A helper edits
that declaration, not a second `value` in JSON. Ambiguous declarations or local
shadowing that prevents a bound target from receiving the intended value are
diagnosed; there is no implicit last-match or scope guess.

Bindings project variable values into a **prepared copy** using current
parameter descriptors and unit/scale semantics. They never change persistent
Cell values. The nominal value, then variable sweep point, then exact-parameter
axis retain today's precedence. A temperature axis replaces the declared
nominal temperature for that prepared member; it does not append competing
`.temp` directives. Runtime `alter`/temperature changes stay authored control
actions, not a promise that the entire run used one constant bias/temperature.
Prepared evidence records the initial projection and the actual script.

The implementation must preserve expressions and scope, not extend the bounded
structural evaluator into a purported complete ngspice evaluator. A binding
whose descriptor cannot faithfully project an expression receives a located
binding diagnostic; unrelated free SPICE expressions do not become illegal.

### Legacy acquisition scope

Canvas voltage/current expression leaves and device-OP selections add:

```ts
circuit: {
  bindingId: StableId;
  callPath: string[]; // authored X-instance path to the bound definition
}
```

Existing `documentId`, object anchors and `occurrence` retain their meaning
**inside that binding**. `callPath` is empty for a top-level binding. For a
subcircuit binding it explicitly selects the authored TB call, for example
`["XDUT"]`; two calls cannot silently share a probe. These are SPICE names,
not invented Project Instance IDs. Preparation resolves them case-insensitively
against the captured author text and generated interface. A stale/ambiguous
call is diagnosed, never rebound to the first matching DUT.

Text-only acquisitions use an additional expression leaf
`{kind: "vector", vector: string}` naming an exact simulator vector. Units come
from parsed evidence, not a user-supplied claim. It grants no Canvas mapping and
does not execute a new expression language. Arithmetic, labels, measurements
and typed Canvas acquisitions reuse the existing evaluator.

## 3. Edits, drafts and concurrency

### Authored files

Extend the existing Simulation File Resource with an explicit Project-folder
owner; keep the existing session-workspace owner. Share list/read/update and
patch codecs, not storage lifetime. Project text cannot expire with a session.
Rename is one atomic remove/write/reference update, not a new filesystem layer.
Both ownership forms normalize to the same source input at preparation; a
session-only text workspace has no implicit live Canvas bindings. At cutover
the public prepared-input discriminator also becomes `source`, rather than
retaining structured/raw/source as three writable product modes. The lower
executor still receives a prepared deck, not this Project authoring schema.

Each Project file edit batch uses the existing expected structure revision and
one Project history entry. Range patches carry the expected text digest and
half-open offsets into that exact text; reject the entire batch on any stale,
overlapping or invalid range. Offsets are UTF-16 code units, matching browser
strings; diagnostics also expose one-based line/column locations. Preserve
authored line endings/comments rather than whole-file formatting on every edit.

GUI typing can remain in a local draft between bounded commits. Run applies
the active folder's draft before capturing input. Save first applies valid edits,
then preserves remaining buffers in optional `input.drafts` with path, base text,
draft text and optional Circuit binding. These are explicitly unapplied buffers,
not parameter overrides; preparation refuses unresolved buffers rather than
running old values. Save/reload retains invalid numeric input and concurrent
drafts without blocking on electrical or syntax diagnostics. Successful file
edits or explicit discard clear the corresponding saved buffer.
Invalid authored syntax is committed as text; it is not silently discarded or made runnable.
Unflushed typing uses editor undo; committed batches use Project undo. The two
histories must not undo the same edit twice. Flush/reload establishes an explicit
history boundary, including writes made by the Agent.

Agent writes are not silently blocked by an invisible GUI lock. A valid
revision-guarded write may commit; an older dirty GUI draft is retained and
marked conflicted, not automatically flushed over it. Return the current
revision on conflict so either client can reread and repair. No automatic
three-way merge or new collaboration protocol is required.

### Generated Circuit parameters

The printer supplies read-only text plus typed editable spans containing the
exact object/parameter target, descriptor, original value and generation input
digest. These spans are derived, never persisted. The digest covers every
reached Document revision and folder state needed for that generation.

- Editable fields are MOS W/L and existing descriptor-backed
  dimension/multiplicity fields and R/C/L value **where a reversible printer
  mapping exists**. V/I source bodies additionally support reversible DC, AC
  magnitude/phase, and PULSE/SIN/PWL clause edits, including adding/removing AC
  and changing the transient waveform. Removing a clause unsets its mapped
  parameters through the same atomic transaction, not an empty-string override.
  This Canvas subset retains explicit DC and complete seven-argument PULSE
  waveforms; arbitrary native source syntax belongs in authored files. Model identity,
  pin order, nodes, references, device class and arbitrary model text are locked.
  Numeric literals and delimited native parameter expressions share those spans.
- Descriptor-backed does not imply reversibility. The compiler must report the
  exact editable fields and conversions; a new unsupported field remains
  read-only. W/L, `nf`, `m`, SI units and PDK scaling use existing semantics,
  not one global multiplier or a regex over the displayed line.
- A mapped edit uses the same typed parameter transaction as Properties. It
  commits all selected parameter changes or none, then regenerates text.
  Cross-structure paste is refused as a whole; no partially applied paste.
- Before commit, validate the generation digest and ordinary document revision
  guards inside the transaction boundary. Old spans cannot edit a new circuit.
- Incomplete/invalid parameter text is a local recoverable draft, not an invalid
  Instance value. Run/Prepare asks to finish or discard it; Project Save may
  save the committed circuit but clearly reports the unapplied draft. Recovery
  retains that draft; an exported Project must not claim it contains the edit.
- Definition edits affect all occurrences and experiments sharing the Cell.
  The UI/helper explains this once at the edit target. Experiment-only changes
  use source parameters/control Code; only legacy experiments retain prepared
  Run Plan projections.
- Helper → Design variable (`.param`) opens the authored run entry and inserts
  a declaration before `.control` (or `.end`), outside the generated Circuit.
  The edit preserves existing text and is one undoable operation. Expressions
  in Circuit still update the shared Cell; every calling experiment must supply
  its dependencies. Root Cell formal defaults are emitted as `.param` when the
  Cell runs top-level, rather than lost with the omitted `.subckt` wrapper.
- Source ghost guidance treats DC, AC and transient clauses independently.
  Missing optional AC/waveform clauses remain display-only, not saved defaults.

The editable Circuit view shows persistent Instance values, not a projected
Batch member disguised as an editable circuit. When a legacy variable binding masks
such a value, expose that binding and link to its authored declaration. The
read-only Prepared view shows the effective projection used for execution.

Known duplicate/shadow definitions of generated Cells and deliberate changes
to their connectivity are preparation errors. Commands that replace the loaded
circuit cannot masquerade as edits to a Canvas-bound circuit: change the Canvas
through its API or explicitly create an unbound source experiment. Parameter
`alter` is not a topology edit. Opaque/dynamic language is not automatically
illegal, but unproven object associations cannot be painted back onto Canvas.

## 4. Compilation and result collection

```text
Project + source snapshot
  -> configuration and include resolution
  -> existing electrical IR / printer / acquisition instrumentation
  -> authored TB/control composition and effective parameter projection
  -> immutable Prepared artifact + source/probe maps + input digest
  -> existing Run/Batch lifecycle -> existing numeric results and exports
```

This pipeline is UI-independent. Share the source-preserving lexer/location
primitives, but do not use the importer's lossy structural projection as an
execution rewriter: opaque commands and repeated includes must retain native
meaning. Do not parse free control into the old `analyses[]` and reprint it.
Generated modules and managed dependency resolution are the compiler's
responsibility; authored stimulus, root calls and analyses are not invented.

Prepared composition may resolve includes and project managed parameters, but
retains original text artifacts and a source map for every generated/replaced
span. It cannot silently rewrite arbitrary author code to satisfy a helper.
Profile paths resolve through the existing dependency resolver, never through
client machine paths. Known model-backed acquisition and execution eligibility
remain Profile-governed; unknown static syntax is not a new analysis blacklist.

Legacy terminal-current sense sources stay in prepared IR for compatibility.
Native Helper acquisition is defined in source (`.probe` or model vectors), not
in that legacy IR instrumentation path. Keep hierarchy aliases and exact object
mappings; never guess MOS currents from `i(m1)`.

### Frozen first collection boundary

One Run has at most one declared ASCII rawfile, matching the
current executor artifact boundary. Version 2 derives the path from Code; version 1
retains its JSON collector and `out.raw` default. Do not add a host filesystem or arbitrary
output directory collector in this refactor. Retain other artifacts already
supported by the executor, but do not promise arbitrary user-written files are
downloadable. A different safe rawfile name requires collection support from
the shared executor capability; otherwise preparation explains the limitation.
Carry the declared collection intent through the shared Prepared/executor
contract. Compiler, Worker and harness must agree on that expectation; do not
keep a JSON-only filename beside a competing regex-derived capture decision.
A provable mismatch with authored capture is a located, repairable diagnostic.

The default template sets `filetype=ascii` and `appendwrite` in a fresh run
directory and writes immediately after each analysis. The compiler emits the
legacy Canvas acquisition `.save` declarations in an inspectable generated preamble;
they are regenerated with the binding map, not pasted as another editable
vector list into author text. Default capture uses bare `write out.raw` to
write the current saved plot. Without configured acquisitions, preserve native
default collection. Native `vector` leaves name results the author collects;
they are not assumed to be circuit vectors available to an initial `.save`.
An authored `save`/`write` may change collection; missing requested vectors then
produce explicit diagnostics, not hidden code repair. Noise templates write
both the density and integrated plots of that invocation. Capture snippets are
ordinary visible ngspice, inserted by the same source helper used by MCP; a
helper must refuse an ambiguous rewrite and return the insertion location.
There is no hidden final `write` claiming to collect all earlier analyses.

Native loops are one Run with multiple plots, not managed Batch members.
Preserve every collected plot and identify it by run/artifact and zero-based
record ordinal, not analysis kind or display `Plotname`. Repeated AC/TRAN/OP
analyses must not overwrite one another. Saved measurements evaluate per
matching record and results carry that identity; cross-run comparison needs an
explicit record choice when there is more than one candidate, never index-based
automatic pairing.

The shared numeric result exposes `rawPlots` as a header inventory and
`rawPlotOrdinals` on each qualified analysis. Output evaluation, saved/automatic
measurements and MOS terminal summaries preserve those ordinals; `analysisIndex`
addresses the qualified array within that result only. Existing archived results
without raw ordinals remain readable, but do not acquire invented provenance.

Noise pairing is deliberately bounded: the existing one-density/one-integrated
case retains full structured Noise. Multiple or reordered Noise invocations
without unambiguous capture provenance retain their raw records with a located
pairing limitation; do not manufacture paired totals. General loop-to-Noise
group provenance is deferred, not a new log parser or an implied completed
capability. Other valid collected analyses remain usable.

Missing/truncated/unsupported data uses the existing result evaluator and
failure semantics, with logs and artifacts still accessible. With an expected
rawfile, no usable result is a failed acquisition, not a successful empty plot.
`collection.rawfile = null` allows deliberate artifact/log-only runs; the UI
must say that no structured result was requested. Native `.meas` text remains
raw evidence until a qualified adapter exists; it is not substituted for the
saved measurement evaluator.

Input identity covers authored bytes, config, binding identities and reached
electrical revisions, dependency digests, Profile identity, effective Batch
point and generated instrumentation. Results always use their own prepared
mapping. Later edits mark evidence stale; they never remap old numbers onto a
new circuit. Export author input, generated snapshots, prepared/executed deck,
raw/CSV and existing plot artifacts through the current File Resource. Export
does not bundle restricted models or grant an imported snapshot live writeback.

## 5. Language assistance and errors

Language data lives with `packages/spice`, independent of React/MCP. One
context-aware catalogue supplies signatures, completion, hover, templates and
lint references. Each implemented rule has a stable ID, language context,
manual/source citation and a positive/negative or opaque-preservation test.
Do not create a complete new parser or LSP as a prerequisite to shipping.

| First scope                                                                                                        | Boundary                                                                          |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Lines, comments, continuation, numbers, delimiters                                                                 | Source-preserving lexical checks                                                  |
| `.include`, `.lib`, `.subckt`, `.ends`, `.param`, `.func`                                                          | Locate and explain declarations, scopes and dependencies                          |
| RLC, V/I, model-backed instance cards; DC/AC/PULSE/SIN/PWL                                                         | Contextual signatures; Canvas editing still follows descriptors                   |
| OP/DC/AC/TRAN/Noise                                                                                                | Distinguish circuit dot-cards from control commands                               |
| `.control`, `.endc`, `save`, `write`, `set`, `let`, `alter`, `alterparam`, `reset`, basic loops/conditions, `meas` | Completion/hover and proven local checks, not a claim of whole-program evaluation |
| Experiment JSON                                                                                                    | Validate the one configuration schema and object bindings                         |

Keep `.param`, B-source and control expression contexts distinct. The current
bounded structural evaluator is not their universal grammar. Valid ngspice
that the local checker cannot understand stays opaque and executable subject
to existing execution safety/authorization. Lack of static understanding alone
must not block prepare/start. Likewise a valid SPICE directive denied by hosted
path policy is an environment diagnostic, not a language syntax error.

Extend the shared diagnostic envelope with optional source location
`{scope, path, textDigest, startOffset, endOffset, line, column}` in addition to the
existing ObjectLocator/field. Use original or prepared file ownership explicitly;
`scope` is `authored`, `generated`, or `prepared`. Navigation must not apply an
old range to newer text. No editor-only error DTO.

Syntax/config/binding failures affect that prepare, not saving authored text,
other experiments or the Agent session. Stale edits return revision evidence;
budget estimates warn, actual safety limits still apply. Busy, timeout, cancel,
lost and artifact failures use existing Problem/recovery semantics. Unexpected
internal failures get correlation IDs, not swallowed exceptions or fake success.

### Language authority available to every implementer

The baseline is ngspice 46, matching the current
[Profile](../../containers/ngspice/hosted-sky130-profile.json), not the moving
online manual or locally installed ngspice 47. Public references:

- [Fixed 46 manual](https://ngspice.sourceforge.io/docs/ngspice-46-manual.pdf):
  sections 2.1/2.4 (syntax), 2.6/2.8/2.10 (hierarchy/includes), 2.11/2.12/2.16
  (parameters), especially 2.11.7 (three expression parsers); 3/4.1/5.1
  (devices/sources); 11.3/11.4/11.6/11.7 (analyses/acquisition); 12.11
  (compatibility); 13.2/13.4/13.5 (control).
- [Official 46 source archive](https://sourceforge.net/projects/ngspice/files/ng-spice-rework/old-releases/46/ngspice-46.tar.gz/download):
  `src/frontend/inpcom.c`, `subckt.c`, `numparam/`, `commands.c`, `control.c`,
  `parse-bison.y`, `src/spicelib/parser/inp2dot.c` and `inpptree-parser.y`
  are implementation reading points, not one complete grammar.
- [Official 46 document source](https://sourceforge.net/projects/ngspice/files/ng-spice-rework/old-releases/46/ngspice-doc-46.tar.gz/download)
  contains the LyX manual; inspect it when extracted PDF formulas are ambiguous.
- [Official control tutorial](https://ngspice.sourceforge.io/ngspice-control-language-tutorial.html)
  explains control and plot handling; it is supplementary, not version-pinned.

Downloaded content identities (SHA-256, locally calculated, not upstream signatures):

```text
ngspice-46-manual.pdf
b5bc7c4f3aac00e670b01b1d1ab64ec87055a491014af1de828764bf98faf766
ngspice-46.tar.gz
a0d1699af1940b06649276dcd6ff5a566c8c0cad01b2f7b5e99dedbb4d64c19b
ngspice-doc-46.tar.gz
6179b56c48bbe08a7e60775b629492df6b4182acafbf1b25c2c8cd78bea13e47
```

The locally verified full reference archive is convenient, not a build or
handoff dependency. Preserve upstream notices; do not ship entire manuals/model
data inside the editor. Official examples are language-test material, not
automatically qualified product circuits. Resolve disputed behavior against
the declared runtime/Profile and retain a minimal reproducible test.

## 6. Human and Agent interaction

```text
Existing application navigation / editing toolbar
---------------------------------------------------------------
Ordinary Canvas                 | Code | Properties           x
                                | Explorer          Run Stop ...
                                | Experiment
                                |   Source (open) / files
                                |   Prepare · Temporary (closed)
                                |   Run · Temporary (closed)
                                | Circuit / TB / Run / artifact tabs
                                |   code editor with line numbers
                                |------------------------------
                                | Console | Plot | OP | Compare          expand
                                | selected run / plot / OP
                                | history, compare, export on demand
```

- Simulation opens Code lazily; opening the ordinary Editor does not load the
  code editor or start ngspice. Reuse the current service and Properties dock.
- Simulation has its own top-level command, outside Netlist. Missing circuit
  parameters do not prevent opening Code. An authoring-only IR keeps device
  cards with explicit missing-value slots; export and execution stay strict.
- Explorer displays every experiment and its source files. The active experiment
  also exposes Prepare and Run artifact groups, each explicitly marked Temporary.
  Source starts expanded; artifact groups start collapsed. Right-click offers
  duplicate, rename, delete, export and Run. Multi-select runs a Batch. File
  actions use the shared File Resource; generated topology remains locked.
- Source and artifact rows support Ctrl/Cmd multi-selection. One selected file
  downloads directly; multiple authored/generated/temporary files download as one
  hierarchy-preserving ZIP. Selecting a temporary artifact opens a read-only tab.
- There is no permanent Prepare or Pick toolbar. Run prepares automatically;
  final-deck inspection and Canvas observation helpers are available on demand.
  Observation helpers reveal the configuration they change rather than silently
  modifying hidden output bindings. Diagnostics use code marks and Console,
  not a top-level input-error alert bar.
- Code and Properties remember independent widths. Start prototype evaluation
  around 40% and 22% respectively, not hard-coded accepted dimensions. Narrow
  windows use a temporary overlay/maximized view instead of crushing Canvas.
- No permanent Setup/Settings/AC-response selection bar. Multiple experiments
  retain IDs and lifecycle under Explorer. Run always targets the explicit entry
  of the active experiment; viewing its Circuit or TB does not change entry.
- Console/Plot/OP/Compare occupy one tab row below the code editor;
  measurements, history and export remain within these views. Maximize
  temporarily uses the main workspace, then restores the exact previous split.
- Canvas selection highlights related code without forcibly opening Properties.
  Switching tabs preserves draft, caret, selection, scroll and result state.
  Closing the presentation is not cancel. Output updates do not steal focus.
- Keyboard routing, IME, undo and paste respect code focus; Delete/Ctrl+A must
  not modify Canvas while typing. Fit View accounts for the dock's insets.
- Keep the existing plot/evaluation/export implementations; do not introduce a
  separate plot theme or numeric parser merely for this mount location.

Agent APIs expose the same file owner, read/range patch, generated text/spans,
parameter edits, container lifecycle, helper patches, prepare/run/cancel, Batch
and artifacts. Extend existing resources instead of new parallel endpoints.
`simulation_folder` remains container lifecycle; analysis/output conveniences
become source/config helpers, never structured-field writers after cutover.
Direct edits remain available whenever a helper cannot rewrite losslessly.
GUI cannot privately assemble a deck or require an extra authorization click
that the authorized MCP path lacks. Existing owner/scope checks still apply.

### Workspace interaction contract

Selection, directory expansion, open editors, keyboard focus and execution target
are distinct UI states. Selecting or collapsing a folder and right-clicking a file
do not change the execution target. Opening a file in another folder selects that
folder for Run; the Run control identifies it. Closing any tab, including the
entry or the last tab, neither deletes source nor changes the entry. Empty editor
views are valid. Folder switches retain their open tabs, selected file and drafts.

File, folder and More commands use one portalled context menu. Menus never occupy
tree layout and only one may be open. Outside pointer-down dismisses without
preventing the destination click. Escape restores focus; arrows/Home/End and
Enter navigate/execute. Commands capture explicit folder/file targets, not an
implicitly changed active editor. Source-workspace and overlay keyboard events
never execute Canvas editing commands.

New/rename uses one inline naming interaction: Enter and valid blur commit exactly
once; Escape or empty blur cancels. Invalid names show local feedback without
trapping focus. New experiments ask only for a name and create the current-Cell OP
starter described above. Delete
uses the product's small modal confirmation with Cancel initially focused and
Escape cancelling. File/Project transactions remain the mutation and Undo owner.

Explorer has a bounded draggable/keyboard-adjustable splitter; double-click restores
the default. Width is an optional local preference, not Project data. Buttons
share hover, pressed, focus-visible, disabled and in-flight styling. Save reflects
the existing Project persistence lifecycle, not merely buffer flush. An unsaved
dot, a saved-but-unapplied draft indicator and source diagnostics are different
states. Invalid source remains saveable, but preparation cannot execute stale
committed values behind an unapplied draft.

Regression acceptance covers cancellation, blur, external clicks, background
targets, empty tabs, folder switches, draft retention and keyboard isolation,
not only the successful button path. No new filesystem, Setup, or persisted
interaction protocol is introduced.

## 7. Valid and refused operations

A minimal unbound experiment has `run.cir`, no circuit bindings/dependencies,
and this `experiment.json`:

```json
{
  "version": 2,
  "environment": { "profileId": "sky130-core-continuous-ngspice46-v1" }
}
```

```spice
* Divider: input syntax example, not new qualification evidence
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

For a Canvas-bound experiment, changing two mapped W/L values atomically is
valid. A paste that also replaces a generated drain node is refused in full
with the locked span and the Canvas edit location. A stale generated digest
instead returns a re-read/reapply conflict. Neither rejection ends the session.
An incomplete `ac dec` in authored text is saved and diagnosed; it is not
silently replaced by the last successfully prepared command.

## 8. Migration, delivery and acceptance

The existing Project upgrader converts v3 once; no long-lived structured/raw/
source triple writer or automatic reverse conversion is allowed.

| Existing intent                | Source representation                                                                                 |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Structured root                | One `top-level` binding to the same TB Cell; no invented root/stimulus                                |
| Analyses                       | Equivalent visible control commands and capture snippets                                              |
| Outputs/device OP/measurements | Config bindings with preserved IDs/labels and explicit circuit scope                                  |
| Design Variables               | Nominal `.param` text plus value-free exact-target bindings                                           |
| Run Plan/Profile/corner        | Config; same point precedence, limits and qualified scope                                             |
| Nominal temperature            | Explicit authored `.temp`                                                                             |
| Raw entry/files/dependencies   | Preserve text/entry/dependencies, add collision-free config path                                      |
| Raw environment                | Config Profile/corner; preserve existing effective temperature semantics without competing directives |

Migration is deterministic and offline. Keep stable setup identity, names and
broken references for repair, not a replacement success template. Generated
paths use deterministic collision-free names. Retain the original import on
failure; never silently overwrite Cloud/Gallery data. A migration does not
grant authority for server-wide data rewriting. Verify old/new effective IR,
parameter values, analyses, acquisitions and numeric results, not byte equality
of differently organized decks.

C0 freezes this contract only. The remaining bounded targets are:

| Target                | Primary owner and exit evidence                                                                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1 — source lifecycle | Model/Edit Engine/File Resource: migration, save/reload, copy/delete, undo, revisions and session/Project isolation                                            |
| C2 — source compiler  | SPICE/netlist/service and execution collection adapter: reversible parameter spans, scoped variables/scaling, authored/Canvas composition, collection and maps |
| C3 — Agent parity     | Service/Agent/MCP: public file/helpers and real stdio edit → error → repair → prepare/run → export                                                             |
| C4 — code dock        | Editor: layout prototype acceptance, lazy editor, focused browser tests, no lost state or Canvas shortcut leakage                                              |
| C5 — cutover          | Integration: retained feature matrix, same-candidate Preview GUI/MCP numerical journey, removal of old writers/forms/adapters                                  |

C1 and C2 must provide an end-to-end reader/compiler adapter before a new
persisted schema becomes the default. C3/C4 can then progress independently;
neither gets a private simulation protocol. Temporary adapters may be used on
integration branches, but do not land an unreadable/unsupported default Project
format. At cutover update the current specifications, user guide, generated
Agent artifacts and client version together; retire this target-only overlap.

Mandatory retained matrix: OP/DC/AC/TRAN/Noise, voltage/source/MOS terminal
currents, MOS OP, friendly aliases, saved measurements, variables/PVT, Batch
cancel/retry/compare/history/archive, multi-experiment/multi-TB and existing
cross-Project import, pure-text input, and all current input/result exports.
Move the current code rather than replacing tested numerics with new UI logic.

Use the existing OTA Project and qualified divider/RC/Noise/device fixtures;
do not invent new human-importable full-chain example families for this work.
At one candidate SHA and Profile, GUI **and actual MCP** must each edit source,
edit a mapped parameter, prepare, run, inspect aliases/current/measurements,
export input/deck/raw/CSV/plot, exercise a small managed Batch, save/reload, and
repair a deliberate input error in the same session. Record input/artifact
digests, simulator/model/corner identity, numerical tolerances and failures in
the existing acceptance artifacts. Separately test repeated plots, missing
captures, invalid config, concurrent drafts, structural paste, changed DUT
interfaces, two DUT calls and unbound input. A screenshot or HTTP 200 is not
electrical evidence.

The user approved the disposable layout prototype and subsequent Explorer
consolidation: files expand beside code, Source opens by default, temporary
Prepare/Run groups start collapsed,
configuration stays hidden by default, Code/Properties have independent widths,
and Console/Results stay beneath code with reversible maximization. Browser
regressions verify those interactions. That approval does not replace language,
runtime, numerical or delivery acceptance.

The executable acceptance is retained in
[`preview-source-gui-journey.mjs`](../../scripts/preview-source-gui-journey.mjs)
and [`preview-agent-simulation-journey.mjs`](../../scripts/preview-agent-simulation-journey.mjs).
The first drives the real GUI without replacing simulation responses; the second
uses the built stdio MCP adapter after browser authorization. Both verify the
served entry bytes against the candidate build, edit and restore an actual MOS W
parameter, repair authored input, execute the qualified OTA, export evidence and
plots, complete a small managed Batch, and save/reload. Numerical tolerances come
from the existing qualified fixtures, not screenshots. The Preview workflow keeps
both receipts and exported artifacts; native image qualification and the separate
cross-Project journey remain required alongside them.
