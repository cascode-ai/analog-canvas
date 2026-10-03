# Open Issues after the 2026-10-03 batch

A short handoff list: what is left, and what waits for a decision. The GitHub
issues remain the source of each problem's details; this page only says where
each one stands. It replaces the 2026-09-30 list.

## Done in this batch

- **#1250**: a fresh browser tab offers the tabs a closed window left
  ("Reopen tabs"); Esc closes Recover Unsaved Work… wherever focus is.
- **#1249**: SKY130 transistors are placed (GUI and Agent) and imported from M
  cards as the reviewed X calls the SKY130 profile runs; older model-card
  bindings warn with `REVIEWED_DEVICE_AS_MODEL_CARD`.
- **#1265**: a connect passes through its via points, in either listed order,
  or is refused.
- **#1257**: an Agent connect keeps clear of parts and other Nets' pins and
  wires; a transaction that would leave an ambiguous Junction is refused; a
  supply Pin added to a Cell not yet placed sits on the block's top or bottom.
- The Gallery census blocks on netlist marks that change without a
  `NETLIST_MARK_RULE_VERSION` bump.
- **#1262** and **#1252** were closed; both were done on 2026-10-01.
- Later the same day: IHP SG13G2 as a process (front-end: drawing and
  netlists), browser checks before a pull request limited to the cases a
  change edits, a census that runs only the checks a change needs and
  reuses its base, and unit tests that share modules (about 2.5 minutes to
  about half a minute).

## Deferred to the simulation batch (owner, 2026-10-03)

- **#1243**: run metadata digests (`netlistSha256` of `""`, deck digest of the
  entry file only).
- **#1263**: simulation Agent tools (batch outcomes and values, one
  discriminator key, owner hints, parameter-axis labels), plus the ordering
  carried from #1252: blockers before info in a refused run's diagnostics.
- Whether a floating-node circuit that ngspice rescues by gmin stepping, with
  results, should count as failed (it does today).

## Partly done

- **#1267**: the Agent's `place-component` does not yet use the GUI contact
  planner (a part dropped over a wire's end).
- **#1258**: the waveform list still shows the internal current sensor
  (`i(v.xdut.v__icm_sense_…)`) instead of the pin current it measures.

## Next

- **#1227**: per-hop timing for Agent calls.
- **#1254** (op-amps shown as A1) and **#1256** (auto-naming at placement, a
  signal-flow formula action).
- Batch refusals now say how to split; still not done: a power rail in the
  same batch as placements, and a delete across transactions as one undo.
- Seven old Gallery drawings hold zero-length wires that make a marquee
  delete fail (19 cases): a data or planner fix, not chosen yet.
- Gallery cold start: the Worker bundle (MathJax, netlist, render) would
  have to be split.
- The flaky browser case "Shelf cards duplicate, rename, export and keep
  account favorites without entering the canvas" (`gallery.spec.ts`).
- The flaky browser case "Gallery navigation uses the replacement decision
  without a second browser prompt" (`project-file.spec.ts`): under four
  workers on a loaded machine R1 came back after Continue without saving and
  a return to `/editor`. It passes alone; why the tabs are normally gone on
  return is not yet traced.
- Browser case trimming awaits the owner's choice: 36 parameterized tests
  expand to 114 of the 711 cases; keeping one or two variants of each would
  drop about 40 (about a minute of a full run at four workers).
- IHP SG13G2 simulation: its MOS (PSP103) and resistor (r3_cmc) models need
  OSDI modules built with OpenVAF; hosted simulation has no SG13G2 profile.

## Waiting for a decision or details

- **#1231**, **#1211** (writes need confirmation), **#1105** (label
  defaults).
- Two reported editor bugs need details: a mouse drag that does not move a
  part while a trackpad does, and R2 not connecting automatically.
- The external pull request adding a local Virtuoso schematic export tool
  asks for feedback on scope and directory layout.
- Large proposals stay parked: #1119/#1121 (offline desktop build),
  #1117 (Agent drawing benchmark), #1114, #1113, #1112.
