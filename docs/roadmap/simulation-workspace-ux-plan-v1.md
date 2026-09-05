# Simulation Workspace UX v1

Status: proposed product-interface plan

Baseline: `main` at `73f44f76` (2026-09-05). The structured OP/AC Preview
baseline, same-Project Cell reuse, occurrence-aware voltage/source-current
probes, shared Simulation Service, GUI/MCP parity, and exact-Preview acceptance
already exist. This plan reorganizes those capabilities for a human user. It
does not replace the full-scope
[simulation vertical plan v13](simulation-vertical-integration-plan-v13.md) or
change the accepted simulation contracts.

## 1. Product decision

The current interface is an engineering MVP, not the finished Simulation
workspace. Its main defect is not that it exposes hierarchy concepts; Cell,
Symbol and Testbench are legitimate EDA concepts. The defect is that their
roles and transitions are scattered across unrelated menus and are not kept
clear after the transition.

The human workflow therefore keeps three explicit stages:

```text
DUT Cell
  -> derive or review its Symbol View
  -> create or choose a Testbench Cell
  -> insert one occurrence of the DUT Symbol in that Testbench
```

This follows the useful Virtuoso mental model without introducing separate
schematic/symbol files or a second Project format. In Analog Canvas:

- the DUT remains an ordinary Cell definition;
- its formal interface plus optional presentation is the Symbol View
  authority;
- the runtime Symbol remains derived, not a copied electrical definition;
- the Testbench is a distinct ordinary Cell in the same Project for the first
  release;
- `SimulationSetup.input.rootDocumentId` designates the Testbench role;
- creating a Testbench does not change the Project top or mutate the DUT;
- inserting the Symbol creates a normal hierarchy Instance of the DUT.

`Review Symbol` remains available, but only custom presentation requires it.
A valid formal interface can produce the default Symbol without sending the
user through Cell Manager.

## 2. Target journeys

### 2.1 Current Cell to a new Testbench

Opening Simulation with no setup shows one focused starting surface:

1. **Choose DUT.** Default to the current Cell, with an option to choose
   another Cell in the current Project. Show its formal ports and readiness.
2. **Create Symbol View.** Show the derived Symbol preview and port order.
   `Continue` accepts the derived view without persisting a default
   presentation; `Customize…` opens the existing presentation editor.
3. **Choose Testbench.** Create a named Testbench or choose an existing Cell.
   The screen states that it is a separate Cell and that Project top is
   unchanged.
4. **Insert DUT.** Enter a visible `Place DUT` interaction in the Testbench.
   For a newly requested Testbench, Cell creation, DUT placement, and initial
   setup-root binding commit as one completed workflow when the user places
   the DUT. Escape before placement cancels the pending workflow and leaves no
   accidental empty Cell. An explicitly created empty Cell remains legal.
5. Continue authoring sources, loads and wires on the ordinary canvas. Source
   values stay on source Instances.

After completion the workspace always identifies both roles:

```text
Project: Amplifier  /  Testbench: Main_tb       DUT: Main
```

The DUT label opens the definition; the Testbench label returns to the
simulation root. Navigation must not silently change either role.

### 2.2 Existing Testbench

If a saved setup exists, Simulation opens on its Testbench and restores the
authored analyses and probes. If the root or a probe target is unavailable,
the workspace stays open, labels the broken reference, and offers a direct
repair action. It does not delete or silently retarget the setup.

The user may also choose an existing Cell as a new Testbench. The interface
must distinguish `Open Testbench` from `Use as DUT` even when both choices are
ordinary Cells.

### 2.3 Saved Project source, later slice

The same DUT chooser will eventually add `From Saved Project…`. That action
reads an authorized Project snapshot, previews the Cell dependency closure,
and imports a local copy through the shared Project/Cell service before the
same Symbol/Testbench/Insert stages continue. It is not a runtime URL
reference and is not a prerequisite for the current-Project UX slice.

## 3. Workspace layout

Simulation is a lightweight Editor mode, not one long modal form:

```text
+-----------------------------------------------------------------------+
| Simulation  DUT: Main v  TB: Main_tb  OP + AC   Ready        [ Run ] |
+--------------+-----------------------------------+--------------------+
| Components   |                                   | Setup              |
|              |         Testbench Canvas          | (only when open)   |
|              |                                   |                    |
+--------------+-----------------------------------+--------------------+
| Results [Summary] [Plot] [Operating Point] [Console] [Files]         |
+-----------------------------------------------------------------------+
```

- The top task bar owns context, concise state and the single primary action.
- The normal canvas remains the Testbench editor.
- Setup opens on demand in the existing right-side region; it is not a second
  permanent column when closed.
- Results opens only when requested or when a run finishes, uses a resizable
  bottom dock, and displays one view at a time.
- Closing Setup or Results never cancels a run. Only `Stop` does that.
- Console, identity and artifact hashes are technical detail views, not the
  default result.

The existing fixed 510 px scrolling drawer is retired after equivalent
behavior has moved to this composition. The development-only Digital
Simulation window remains separate and is not enabled by this work.

## 4. Interaction lifecycle

The service remains the run authority. A pure UI projection derives the
human state instead of coordinating independent `busy`, `dirty`, `prepared`,
`run` and `error` flags ad hoc.

```text
Setup:   absent -> draft -> saved -> changed
Prepare: idle -> preparing -> ready | needs-input | stale
Run:     idle -> starting -> running -> completed | failed | cancelled | lost
Result:  current | stale
```

Only the relevant primary action is emphasized:

| State | Primary action |
| --- | --- |
| No Testbench | Create or open Testbench |
| Draft differs from saved setup | Apply setup |
| Saved input has no current prepared artifact | Run |
| Prepared input is current | Run |
| Running | Stop |
| Completed or failed with recoverable input | Run again / Fix input |

For the common path, `Run` performs at most one necessary prepare and then
starts that exact digest. `Prepare and inspect deck` is an advanced action in
Files; it does not cause a later Run to create an unexplained second prepared
input when the Project and setup are unchanged.

Project edits mark existing prepared input and results stale. They remain
inspectable and exportable with their revision. Browser reload may lose the
transient run registry; the UI states this boundary and never claims to have
resumed or rerun it.

## 5. Diagnostics and recovery

The existing `Problem` envelope already carries `code`, `stage`, `recovery`,
diagnostics, fields and Object Locators. The interface must consume that
structure instead of flattening it into a `<pre>` string.

Each human-facing problem contains:

- a short statement in circuit language;
- what input or environment caused it;
- one recommended next action;
- `Show on canvas` or focus-field behavior when a locator/field exists;
- retry timing when the service supplies it;
- expandable technical details containing codes, correlation ID and raw log.

Recovery maps directly from the shared contract:

| Recovery | Human behavior |
| --- | --- |
| `fix-input` | Focus the setup field or locate the circuit object; keep the session and draft |
| `reprepare` | Mark prepared input stale and offer Prepare/Run again |
| `retry-same-request` | Retry the identical request identity, never create a second run |
| `retry-after` | Show a bounded wait and retry action |
| `reauthorize` | Explain the session change and reconnect without blaming the circuit |
| `not-retryable` | Preserve evidence and show technical details/report path |

Deterministic mistakes are caught before execution when practical. For an AC
sweep, display `points/decade` or `points/octave`, calculate the expected row
count, estimate output risk from analyses and probes, and stop obviously
oversized requests with a suggested safe resolution. Rawfile truncation still
remains a truthful executor/result failure if prediction cannot prevent it.

Warnings never masquerade as run failure. ngspice progress text and model
notes live in Console unless a structured diagnostic promotes them.

## 6. Controls and visual language

Create a deliberately small set of editor controls shared by Simulation and
the later Project/Cell picker:

- `Field` and field help/error text;
- `SelectPopover` and searchable `Listbox`;
- `NumberFieldWithUnit`;
- `SegmentedControl`;
- `StatusChip`;
- `InlineNotice`;
- `Tabs` and resizable dock shell.

They use existing editor tokens, keyboard navigation and ARIA semantics.
Native inputs may remain inside a styled primitive where that is the correct
platform control, but raw browser `<select>` and `<datalist>` are not the
finished product surface.

Environment selection is capability-driven:

```text
SKY130 Core 1.8 V  ·  TT  ·  27 °C                 [Details]
```

With one qualified Profile and one corner, select them automatically and do
not ask the user to type an internal Profile ID or corner. If multiple
Profiles become available, the service exposes bounded display metadata and
the same control becomes a searchable choice. Paths, digests and startup
identity remain in Details.

AC authoring uses circuit units and exposes the real meaning of resolution:

```text
Sweep       [ Decade | Octave | Linear ]
Range       [ 1 Hz ] -> [ 1 MHz ]
Resolution  [ 20 ] points / decade
Estimated   121 frequency points
```

## 7. Probes and results

The occurrence-aware voltage and source-current probe contract merged in
`fff8f92e` is sufficient. This plan changes only its human projection.

Probe entry points are:

```text
[ Pick on canvas ]  [ Browse hierarchy… ]
```

The browser is searchable and preserves occurrence identity:

```text
Main_tb
|- Vin
|- Vout
`- X1 / Main
   |- tail
   `- nleft
```

Selected probes form a compact list with friendly name, quantity, hierarchy
path, locate, trace visibility and remove actions. Internal IDs stay in
Details. A missing target is shown in place and can be repaired.

Results reuse the structured OP/AC data and File Resource:

- Summary states outcome, elapsed/run identity and stale status;
- Plot provides trace visibility, legend and cursor values;
- Operating Point uses friendly probe names and units;
- clicking a mapped result locates the corresponding circuit target;
- Console contains diagnostics and raw simulator text;
- Files contains prepared deck, executed deck, rawfile, JSON, log and CSV.

Multi-run comparison and expression calculators remain later work.

## 8. Architecture boundary

This is a UI/application-layer convergence, not another simulation protocol.

- `@icm/model` remains the saved setup authority.
- ordinary source Instances remain stimulus authority.
- `@icm/netlist` remains structured prepare/probe-map authority.
- `@icm/simulation-service` remains prepare/run/error/artifact authority.
- File Resource remains artifact transport.
- existing Project transactions remain the only mutation path.
- GUI and MCP continue to consume the same service and diagnostics.

Expected editor decomposition:

```text
simulation-workspace-model.ts       pure derived UI state and primary action
simulation-problem-presentation.ts  Problem -> human presentation/actions
simulation-dut-flow.ts              compose existing Cell/Symbol/TB planners
simulation-task-bar.tsx
simulation-setup-inspector.tsx
simulation-probe-browser.tsx
simulation-results-dock.tsx
simulation-controls/*               small shared control set
```

The current monolithic surface is split only as behavior migrates; no second
run registry, setup cache, error code family, Project model or hierarchy model
is introduced.

## 9. Delivery slices

### UX0: freeze journeys and view model

Characterize the current saved-setup, close/reopen, stale, cancel, failed,
lost and artifact behaviors. Add the pure UI state projection and problem
presentation contract before moving layout.

### UX1: DUT, Symbol and Testbench flow

Implement the explicit three-stage flow, current-Project DUT chooser, role
breadcrumbs and cancellation semantics. Compose existing hierarchy and
Project planners; do not copy their validation.

### UX2: controls and Setup inspector

Add the bounded control primitives, capability-led Environment summary,
analysis fields with units/estimates, and one primary action. Replace native
Profile/corner/probe choices.

### UX3: diagnostics and recovery

Consume stage/recovery/locator/field, add canvas and field navigation, add AC
size preflight, and demote raw codes/logs to technical details.

### UX4: probes and Results dock

Add canvas/browse probe workflows and the single-view Results dock while
preserving File Resource exports and stale identity.

### UX5: current-Project acceptance and cleanup

Retire the old 510 px surface after parity is demonstrated, update user docs,
and run one exact-Preview human journey plus the existing MCP journey on the
same candidate.

Cross-Project browsing/import is a subsequent Project/Cell slice that plugs
into the DUT chooser; it is not hidden inside UX1.

## 10. Acceptance

For a valid current DUT, a person can complete:

```text
Simulation
-> choose current DUT
-> inspect/accept its Symbol View
-> create Testbench and place DUT
-> add/wire source and load
-> select OP/AC and probes
-> Run
-> inspect Plot/OP
-> export deck/raw/CSV
```

Acceptance requires:

1. Project, DUT and Testbench roles remain visible and Project top is not
   changed.
2. Default Symbol derivation needs no Cell Manager visit; custom presentation
   still round-trips through the existing authority.
3. Cancelling the guided creation before placement leaves no accidental Cell,
   Instance or setup.
4. A single advertised Profile/corner requires no manual selection or internal
   ID entry.
5. An invalid probe or circuit parameter points to its field/object and a
   corrected input can run in the same session.
6. An oversized AC request is explained before execution with its estimated
   point count and a usable correction.
7. Closing Setup/Results preserves an active run; Stop is explicit; stale
   results remain labelled and exportable.
8. GUI and MCP prepare the same saved setup to the same digest and consume the
   same result/error envelope.
9. Keyboard, focus order, screen-reader names, narrow desktop behavior and
   long hierarchy names have focused browser coverage.
10. The tracked SKY130 OTA completes OP+AC on Preview and the user-created RC
    flow completes without relying on raw internal codes or manual Project
    JSON edits.

## 11. Deliberately later

- cross-Project Cell closure import and account-level Project management;
- structured TRAN and formal PULSE/SIN authoring (tracked separately by
  Issue #560);
- multiple saved setups, run comparison and waveform expressions;
- additional SKY130 Profiles/corners/device families;
- changing the executor, runner lifecycle, result schema or production release
  policy solely to restyle the human interface.

