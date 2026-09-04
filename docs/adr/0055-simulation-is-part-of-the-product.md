# 0055 - Simulation is part of the product

Status: `accepted`

Date: `2026-09-01`

Owners: `packages/netlist`, `packages/derived`, `packages/devices`, `worker`,
`apps/editor`, `apps/local-host`

## Context

Every document in this repository has opened with the same sentence: Analog
Canvas is an editor and a structural circuit tool, **not a simulator**. That
boundary was not an oversight. It kept the model honest — a Net is an
electrical fact, a Route is drawing — and it kept the product finishable.

It also left the person who draws a circuit with no way to ask whether the
circuit works. They export a netlist, leave for another tool, and come back to
edit. The drawing and the answer live in different places, so the loop that
matters most in analog design is the one the product does not close.

The owner has decided to close it. This ADR records that the boundary moved,
why, and what did not move with it.

Three facts shaped the design:

**The netlist already exists.** `@icm/netlist` emits a deterministic,
hierarchical SPICE netlist today (`.subckt`, `X` calls, devices with
parameters). Simulation does not need a second extraction path; it needs a
binding from our device descriptors to a specific PDK's model names and
parameter conventions.

**The PDK a simulator needs is small.** The full Sky130 distribution measures
2.1 GB, but the SPICE model files ngspice actually reads are **52 MB**. The
rest is layout and standard-cell data no circuit simulator touches. That
difference is what makes a hosted container practical rather than absurd.

**ngspice is a native program.** A Cloudflare Worker is a V8 isolate; it runs
JavaScript and WebAssembly and cannot execute a native binary. Cloudflare
Containers do run ordinary images, with a 20 GB image ceiling and 1 to 3
second cold starts.

## Decision

**Simulation is part of the product.** The opening sentence of `CLAUDE.md`
changes from "not a simulator" to a scoped statement: Analog Canvas edits
circuits and can simulate the ones that are fully described at the transistor
level.

**A circuit is simulatable when every instance resolves to a PDK device
model.** Hierarchy does not disqualify it: a `.subckt` whose contents are
transistors is simulatable, recursively. Abstract blocks — signal-flow
elements, behavioural amplifiers, anything with no device model behind it —
are not, and a document containing one is refused with the specific instances
named. Refusal is a diagnosis, never a silent failure.

**The testbench is the author's, not ours.** Analog Canvas supplies the
circuit netlist and runs the simulator. Stimulus, loads, analysis statements,
and sweeps come from the author. We ship no templates and infer no intent.
This is deliberate: a testbench encodes what the designer is trying to prove,
and guessing it would produce confident answers to questions nobody asked.

**Simulation runs server-side first, on Cloudflare Containers**, with the
local host as the second surface behind the same interface. Both consume the
same netlist and return the same result shape; only the location of ngspice
differs.

**The first release covers DC operating point and AC analysis.** Transient,
sweeps, and PVT corners follow once the path is proven end to end.

## Alternatives considered

### ngspice compiled to WebAssembly, in the browser

- Benefits: no server, no cost, the circuit never leaves the machine.
- Costs: the model library ships to every visitor; browser memory and single
  thread bound the circuit size; the WASM build becomes ours to maintain.
- Reason not selected: the owner judged it the wrong shape for the problem,
  and the same build server-side would inherit tighter limits than a browser
  tab, not looser ones.

### Local host only

- Benefits: the circuit never leaves the machine; the user's own PDK version;
  no hosting cost; `apps/local-host` already exists.
- Costs: only users who install it can simulate, which is most of them not.
- Reason not selected as the first surface: it serves the fewest people while
  costing the same engineering. It remains the **second** surface, because the
  privacy argument is real for anyone whose circuit is not theirs to upload.

### A conventional server or virtual machine

- Benefits: no platform limits.
- Costs: a second deployment target, its own operations, its own bill.
- Reason not selected: Containers reach the same capability inside the
  deployment we already have.

## Consequences

### Positive

- The design loop closes inside one tool.
- The simulatability verdict is a reusable projection: the editor can grey out
  the action and say why before anyone runs anything.
- The netlist path gains a real consumer, which is the strongest test a
  netlist printer can have.

### Negative or limiting

- **The circuit leaves the author's machine.** A hosted simulation uploads the
  netlist to a container. This is stated in the product, not buried: anyone
  whose circuit may not be uploaded must use the local host instead. That is
  why the local surface is a commitment in this ADR and not an aspiration.
- Simulation costs money per run. At the metered rates a run is on the order
  of one hundredth of a cent, and the paid plan's included allowance covers
  roughly two thousand runs a month before overage, but the cost is not zero
  and grows with use.
- A container starts with a fresh disk. Nothing accumulates between runs, so
  every run pays its own setup.
- Abstract blocks stay unsimulatable until someone gives them device-level
  implementations. This is a real limit of the first release, not a defect.

### Not changed by this decision

The electrical invariants are untouched. Connectivity is still explicit; a
Crossing is still not a Junction; Routes are still drawing. Simulation reads
the model and never writes it: a simulation result is not persisted into the
Project and cannot alter a Net. The edit engine remains the sole mutation
boundary, and nothing in this feature edits a document.

## Compatibility and migration

The original 2026-09-01 decision introduced execution without persisted
simulation configuration. The 2026-09-04 amendment below replaces that
boundary: when the optional Project `SimulationSetup` lands, the schema version
moves and existing Projects migrate with the field absent. Their circuit,
hierarchy, and structural-export behavior remains unchanged. Results, run ids,
simulator paths, prepared decks, and caches remain transient and require no
Project migration.

The version moves `0.1.0` to `0.2.0` to mark the scope change, and a
`CHANGELOG.md` starts at that entry.

## Validation

- A benchmark circuit from `analog-arena` (`sky130-ota-5t`, a five-transistor
  OTA whose netlist is `.subckt` plus six `sky130_fd_pr__nfet_01v8` and
  `pfet_01v8` instances) is drawn in the editor, exported, simulated, and its
  operating point compared against ngspice run directly on the reference
  netlist. Agreement on node voltages is the evidence that the export binding
  is correct.
- A document containing a signal-flow block is refused, and the refusal names
  the block.
- A hierarchical document whose subcircuits contain only transistors is
  accepted, proving the recursive rule.

## Related documents

- `docs/specs/schematic-model.md` for what an Instance carries.
- ADR 0054 for the single Instance Reference authority the netlist prints.
- `analog-arena` `benchmarks/v2` for the circuit and testbench shapes this
  targets.

## Amendment — 2026-09-04: the contract of the first release, frozen

The owner asked for the simulation feature to be finished on the preview
channel (ADR 0057) and promoted to production afterwards. The vertical
integration plan written for that work (v3, in the roadmap branch) reviewed
the implementation as it stood and found the pieces present but not joined:
the panel not mounted, no producer of operating-point results, the
requested analyses not driving the deck, runs returning only a log, and no
container bound anywhere. This amendment freezes what the first release is,
so the joining work has one contract to build against. The rules below
supersede the sentences of the original decision they contradict; the
[simulation spec](../specs/simulation.md) carries the normative detail.

1. **Analyses.** The first structured release covers DC operating point,
   AC, and transient. Transient uses `.tran tstep tstop [tstart [tmax]]`
   with no `UIC` unless the author asks; the solver's real time axis is the
   result, never a resampled one.
2. **What is simulatable.** A circuit is simulatable when every placed
   instance resolves either to a native SPICE primitive the deck printer
   knows (resistors, capacitors, inductors, independent voltage and current
   sources, ground) or to a device model present in the selected
   environment. The original rule required a PDK model behind every
   instance; that would have refused an ideal resistor. Abstract blocks are
   still refused, by name, before anything runs.
3. **Two inputs, one run.** The author's intent is the authority. It is
   expressed either as a **structured** setup the product compiles into a
   deck, or as **raw SPICE** the author submits as an entry file with its
   dependencies. Exactly one of the two drives a run; the product never
   appends stimulus, analyses, or a root call to raw text and never guesses
   a testbench. "The testbench is the author's" keeps its meaning and drops
   the implied requirement that it be hand-written: helpers may generate
   text, and the author submits it.
4. **Roots.** The simulation root (`rootDocumentId`) is the Testbench Cell
   chosen for one setup; it is neither the DUT Cell nor necessarily the
   Project's top, and choosing it never changes the top. The DUT is an ordinary
   project-local subcircuit Instance in that Testbench. Preparation reads the
   root from the setup rather than accepting a second caller override. The
   compiled deck instantiates that root exactly once; a document that only
   defines `.subckt`s is not a run.
5. **Sources.** DC bias, AC magnitude and phase, and a transient waveform
   are components of the same source Instance in the Testbench, printed by the
   descriptor and edited through the ordinary Project edit path. A setup or UI
   does not retain a second copy or override of those values.
   `PULSE` and `SIN` are formal parameters in the first release; `PWL`
   arrives through raw input. The existing pulse source keeps its symbol
   and its clock-style parameters, which are normalised into the same
   waveform parameters rather than becoming a second authority.
6. **Persistence.** A Project may carry one optional `SimulationSetup`
   holding either the structured input or the raw files. Results, run ids,
   receipts, simulator paths, and caches are never persisted, including a
   "recent run" link. The schema version moves when the setup lands, not
   before.
7. **Environment.** The hosted simulator is a container image pinned by
   digest, and the model set is part of that pin. Direction chosen: the
   image is built on the benchmark toolchain image
   `ghcr.io/arcadia-1/circuit-bench-sky130-ngspice` by digest, so the
   simulator and the model library are the same bytes the benchmark suite
   runs, and a numerical disagreement can only mean the export is wrong,
   never that two ngspice builds differ. The binned Sky130 models a volare
   checkout provides cap device width at 100 µm and refuse the benchmark's
   own reference circuit (#551). **Decided (owner, 2026-09-04):** the image
   is public, so the deploy runner pulls it without a token. #570 builds the
   simulator on it by digest, and the hosted default library is the
   continuous `sky130.lib.spice` it ships; on the preview that library
   loads in under a second and simulates the w=200 device that opened #551,
   which is closed with the measurements.
   A structured setup names only a Profile ID plus allowed author selections
   such as corner and temperature; it does not copy the Profile manifest,
   model path, binary digest, or measured environment fingerprint.
8. **Execution boundary.** Before the hosted route is public: the process
   runs as a non-root user, in a fresh working directory per run, with a
   minimal environment carrying no platform secret; a timeout terminates
   the whole process tree; one container runs one job at a time and answers
   `busy` otherwise; deck size, output size, and duration are capped, and
   truncation is reported rather than hidden. Raw `.control` is a real
   capability, so isolation is the answer to it, not a ban.
9. **Run lifecycle.** A run is started from an immutable prepared input and
   answered with a receipt; status and results are read, and a cancel
   really terminates the process. The input identity covers the whole
   hierarchy the root reaches plus the setup, so editing a sub-Cell makes a
   result stale; a stale result is kept, marked, and never re-bound to the
   changed circuit.
10. **Results.** Numbers come from ngspice's rawfile, not from console text.
    The result carries per-probe operating-point scalars with units, AC as
    a frequency axis with complex values per probe, and transient as the
    real time axis with real values per probe. CSV is derived from that
    same data. A magnitude is never labelled a gain until the author has
    named an input and an output.
11. **Rollout.** The feature lands on the preview channel first, with the
    container bound there; production receives the binding with a promoted
    release.
12. **Not in the first release.** DC sweeps, corners and Monte Carlo with
    dedicated UI, Verilog-A, a second simulator, cross-Project live library
    references, automatic two-way sync between arbitrary SPICE and the
    drawing, and any run history store. Raw input may still express what
    the environment's ngspice can execute; absence of a dedicated control is
    not a refusal to run.

Validation grows accordingly: closed-form fixtures (a resistor divider, an
RC low-pass, an RC step) whose rawfiles are asserted against arithmetic;
the five-transistor OTA acceptance comparison against ngspice on the
reference netlist; and the preview deploy simulating one circuit through
the real container on every merge.
