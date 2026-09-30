# Circuit changes and human handoff

This is the shared task policy. Use your selected transport's entry guide for
connection and request mechanics; MCP clients need not implement raw HTTP.

## Establish enough evidence for the task

Identify the authorized Document, current revision and affected objects before
editing. Use a complete Snapshot for unfamiliar topology, hierarchy changes or
broad rerouting when a local projection cannot answer the question. After
placement, read selected instances with the `pins` projection before wiring.
For a known object's placement or route
geometry, use a focused geometry read by stable ID; it does not resolve pins or
connectivity. Counts alone are not pin or connectivity evidence.

Preserve topology unless the user requests an electrical change. Preserve
human-owned work outside the affected area, including locks and groups. A lock
conflict is not permission to remove the lock. Unresolved pin order, bulk/model
semantics or hierarchy binding requires an authoritative fact or a human answer.

## Make the bounded change

Use [native authoring](shared/authoring.md) for placement, displays and Net names.
Use the shared edit path and current Document/Project revisions. For risky
connectivity, destructive or multi-object edits, validate a dry-run before
commit when the risk warrants it. MCP `apply_actions` normally sends one atomic
commit without a separate client-side preview; do not add a preview ritual
when the same server validation and receipt already answer the question.

On a stale revision, refresh affected facts and reconsider intent. Do not replay
an outdated edit against a newly substituted revision. An uncertain transport
result is different: recover with the original request identity, following the
selected transport's retry rules. Interpret structured results using
[response semantics](response-semantics.md).

## Review proportional to the requested outcome

| Task | Completion evidence |
| --- | --- |
| Read/explain | Returned facts with remaining uncertainty; no mutation required |
| Local parameter change | Accepted change and current value; simulation only if electrical validation was requested |
| Placement, labels or routing | Changed geometry/connectivity plus a formal render of the affected area |
| Whole schematic or hierarchy | Complete changed-Document review and affected parent contexts |
| Drawing from a reference (figure, paper, netlist) | `verify` with `expectedNetlist` at `status: "equal"`, or every remaining difference explained, then a render for visual review |
| Simulation | Completed run, captured input identity and retrieved requested results; see the simulation guide |

### Drawing from a reference

A drawing that copies a textbook or paper figure, a Gallery entry or a netlist
is complete when its connectivity is shown to match, not when it looks right.

1. Before placing anything, write the reference as structural SPICE: MOS in
   `D G S B` order, the named ports, and a name for every node the figure
   names.
2. After drawing, run `verify` with `expectedNetlist` and `details:true`. Done
   means `status: "equal"`, or every remaining difference explained to the
   person. `topology: "equal"` already says the wiring matches.
3. Two differences can be harmless; the summary names them apart from topology:
   - `port-order`: a figure does not fix the order of the subcircuit ports;
   - `binding`: the reference binds a device as a model card (`M1`) and the
     drawing as a subcircuit call (`XM1`), or the reverse.
   Skip them with `compare:{portOrder:false,bindings:false}`, or name them in
   the report.
4. Then `render`, or export a PNG, for the visual review.

For example, a two-transistor current mirror copied from a figure:

```spice
.subckt mirror iref iout vss
M1 iref iref vss vss nmos
M2 iout iref vss vss nmos
.ends mirror
```

For visual changes, use [style guidance](circuit-style-knowledge.md) and
[diagnostic policy](shared/diagnostics.md). Do not mechanically clear observations
or polish unrelated areas. A render does not prove electrical performance.

Report changed Documents, requested results and material unresolved issues with
object IDs when available. Explain intentional findings relevant to the task,
not every unrelated warning. Leave a useful review Document selected without
changing the Project's top Document merely to navigate. Never claim simulation
correctness without naming the actual simulator/model/analysis evidence.
