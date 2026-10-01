# Open Issues after the 2026-09-30 batch

A short handoff list: what this batch left unfinished, and what waits for the
next one. The GitHub issues remain the source of each problem's details; this
page only says where each one stands.

## Partly done in this batch

- **#1250, unsaved work in recovery.** Done: every open tab's copy is kept
  (bytes, not a count, bound them), one closed copy per Project, a warning
  when open work exceeds the 12 MB cap, "edit N · time" labels, and Escape
  closes the dialog. Not done: opening `/editor` in a new browser tab does
  not offer to reopen the previous window's tabs. The tab list is still
  stored per browser tab (`sessionStorage` window id in
  `apps/editor/src/document/project-workspace.ts`); another window's saved
  record would have to be found, checked as closed, and adopted.
- **#1267, part dropped over a Wire's end.** Done: the series splice, the
  refusal of a drop that would short a two-pin part, and
  `ERC_SHORTED_DEVICE`. Not done: the Agent's `place-component` still does
  not use the GUI contact planner (the parity gap in the issue).
- **#1258, current-sensing sources.** Done: Simulate and Agent reads no
  longer fail. Not done: the run's waveform list still shows the internal
  sensor (`i(v.xdut.v__icm_sense_…)`) instead of the pin current it measures.

## Not started from the urgent list

- **#1249**: the SKY130 default MOS still writes a plain model card.
- **#1268**: Agent parameter writes are not validated. The 2026-10-01 Agent
  interface fixes covered part of it; the issue stays open.
- The flaky browser test "Shelf cards duplicate, rename, export and keep
  account favorites without entering the canvas" (`gallery.spec.ts`), seen
  timing out once at four workers.

## Done since (2026-10-01)

- **#1255** (bare comparators export a missing subcircuit), **#1260**
  (non-ASCII names merging Nets in ngspice), **#1259** (DUT port order),
  **#1274** and **#1275** are fixed and live.
- MCP 0.17.36 is published, and Production advertises it.
- File holds commands only; the project's name moved to File → Project
  Properties…. Sub- and superscripts stack in one column.

## Next batch

- **#1227**: per-hop timing for Agent calls.
- The P1 list: #1257, #1265, #1264, #1269, #1252, #1261, #1262, #1251,
  #1253, #1263, #1256, #1254.

## Waiting for a decision or details

- **#1243, #1231, #1211**: decisions are needed before work starts. Writes
  for #1211 need confirmation.
- Two reported editor bugs need details before they can be reproduced: a
  mouse drag that does not move a part while a trackpad does, and R2 not
  connecting automatically.

## Release checks not run for this batch

- The Gallery census (`pnpm gallery:census`), which AGENTS.md asks for when
  placement or netlist code changes, was not run: the contact planner now
  refuses drops that would short a two-pin part, which a pasted Gallery
  drawing with such a part would meet.
- The full local browser sweep was replaced by the specs mapped to the
  changed paths.
