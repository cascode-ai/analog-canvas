# Deterministic Digital Timing Simulation

Status: `accepted`

Version: `1.0`

Primary owner: `packages/simulation`

Related ADR: [`0050-deterministic-digital-timing-simulation.md`](../adr/0050-deterministic-digital-timing-simulation.md)

## Purpose and boundary

`@icm/simulation` is a deterministic, read-only digital event layer over one
current `SchematicDocument` and one transient run profile. It consumes the
same derived Logical Nets as ERC and export, never changes Project content, and
never treats waveform artwork as electrical evidence.

The supported model is intentionally bounded:

- four-state `0`, `1`, `X`, and `Z` driver resolution;
- zero-delay combinational Buffer, inverter, AND, OR, NAND, NOR, XOR, and XNOR;
- rising-edge D flip-flop capture with optional `QBAR`;
- two-terminal `pulse-voltage-source` Digital Clocks referenced to Ground; and
- integer-picosecond time.

It does not model analog thresholds, transistor behavior, propagation delay,
setup/hold windows, metastability, hierarchy, PDK models, or SPICE analyses.
Unsupported components produce diagnostics rather than guessed behavior.

## Run profile

`DigitalSimulationProfile` persists nowhere. It contains a positive safe-integer
`stopTimePs`, Base-Net IDs selected for observation, an optional positive
`maxDeltaCycles`, and optional explicit `0`/`1` startup state by DFF Instance.
An unspecified DFF starts at `X`; a valid authored `initialQ` is used when the
profile does not override it.

Saved Net IDs are observation requests, not probes or connectivity. At run
time they resolve through current Logical-Net equivalence. Repeated Base-Net
IDs in one Logical Net yield one trace; an unknown saved Net yields a warning
and no fabricated trace.

## Extraction and execution

Extraction resolves current Base Nets into Logical Nets before mapping device
pins. A Logical-Net naming or power conflict is an error. Digital Clock `+` is
the driven Net; `-` must resolve to Ground and must not be the same Logical Net.
Clock period and duty cycle must produce positive integer-picosecond high and
low intervals.

At each event time, all scheduled drivers update in deterministic order,
combinational logic settles through bounded delta cycles, rising DFF clocks
capture, and the network settles again. Conflicting active drivers resolve
through the four-state logic rules. Failure to settle is an error and ends the
run.

`DigitalSimulationResult` records the input Document ID and revision, a
deterministic input fingerprint, stop time, traces, diagnostics, and
`completed`. Any error makes `completed` false; warnings may accompany a
completed result.

## Editor and presentation

Digital timing is not a published production product surface. The local
development editor exposes Digital Clock authoring and one Digital Simulation
window behind `VITE_ICM_TIMING_UI`; production builds disable that flag by
default, and the Cloudflare deployment sets it to `disabled` explicitly. A
staging build may opt in with `enabled`. The simulation package, persisted
Project compatibility, and structural Pulse Source export do not depend on
this presentation flag.

When enabled, the window provides run setup, saved-Net selection, waveform
viewing and export, and optional grouped canvas placement. Panel state and run
results are transient. An explicitly placed waveform is ordinary authored
drafting content; it is a snapshot presentation and does not become live
simulation state.

Waveforms use the reviewed Razavi timing presentation—stacked square traces,
signal labels, dashed guides, and a horizontal time axis—without deriving event
semantics from the reference pixels.

## Valid and rejected examples

A Digital Clock whose negative terminal reaches Ground, whose positive
terminal drives an inverter, and whose output Net is saved is valid and
produces deterministic clock and inverter traces.

A Digital Clock with both terminals on one Logical Net, a non-Ground negative
terminal, an invalid period/duty cycle, a missing required gate pin, an
unresolved Logical-Net conflict, or a network that exceeds the delta-cycle
bound is rejected with a `SIM_*` error and `completed: false`.

## Validation

- `packages/simulation` unit tests own extraction, four-state logic, event
  ordering, DFF capture, fingerprints, diagnostics, and determinism.
- device and netlist tests own Digital Clock parameters and SPICE/Spectre
  `PULSE` output.
- editor and browser tests own the opt-in local setup, saved Nets, waveform
  export, clipboard, and grouped placement; flag and deployment tests protect
  the production-hidden state.
