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

No change to the persisted Project. No schema version bump, no migration, and
no existing file loads differently. Simulation is additive: a document that
could be opened yesterday opens identically today and merely gains an action
that may report it is not simulatable.

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
