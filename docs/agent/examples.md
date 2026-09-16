# Reproducible Agent Workflows

The schemas and request fixtures in
[`../../fixtures/agent-api/`](../../fixtures/agent-api/) are checked by the
Agent adapter tests. The retained guidance-structure report lives in
[`../../fixtures/agent-layout-eval/`](../../fixtures/agent-layout-eval/).

## 1. Read once, edit, render, refresh

1. Call `capabilities` and select a Document from the Project Index.
2. Send [`snapshot.request.json`](../../fixtures/agent-api/snapshot.request.json)
   and retain its revision and hash.
3. Infer only from the complete Snapshot facts; load relevant knowledge pages.
4. Dry-run a typed transaction with `expectedRevision`.
5. Commit the unchanged transaction, render the affected area, then request a
   fresh Snapshot for final review.

Expected result: one read supplies the Document facts, the revision advances
only on commit, and formal topology remains unchanged by presentation edits.

## 2. Create a blank CMOS inverter in two phases

1. Download the Agent Kit and use its reviewed authoring catalog to identify
   `pmos`, `nmos`, `ground`, `port`, and the `vdd-rail` primitive. Do not infer
   their IDs or pins from appearance.
2. Read the blank Document Snapshot. Dry-run then commit placement of the two
   MOS instances, ground, input/output `port` Instances, and a VDD rail. `vdd` is not a
   Symbol: submit the catalog-defined `add_power_rail` primitive.
3. Read a new Snapshot. Use its returned terminal IDs and positions to submit
   ordinary `wireIntent` connections for gates, drains/output, NMOS source to
   ground, and PMOS source to the VDD rail.
4. Read another Snapshot, set/reconcile an explicit NMOS ground bulk default
   only when the returned `mosBulk` facts require it, then verify both MOS body
   connections from the final Snapshot.
5. Render and review the final Document. The Kit catalog supplied the initial
   product facts; every live connection came from Snapshot plus the Edit Engine.

Expected result: a browser Agent can create a basic inverter without repository
source, manual seed components, dynamic catalog lookup, or guessed pin order.

## 3. Add an explicit branch without inventing crossing connectivity

1. Inspect the Snapshot's complete Net, Route, and Junction facts.
2. Dry-run one `wireIntent` from the terminal endpoint to the target
   `route-segment` anchor. The shared GUI planner owns the Junction ID, Route
   split, Net merge, and Route creation choreography.
3. If validation reports an unintended connection or lock conflict, stop and
   revise the route; do not infer connectivity from a geometric crossing.
4. Inspect `diagnosticDelta`, commit, render, and refresh.

Expected result: a Junction dot exists only for explicit same-Net branches;
unrelated geometric crossings remain dotless.

## 4. Recover from a human/Agent revision race

1. Read revision 42 and prepare a placement transaction.
2. A human edit commits revision 43 through the GUI.
3. Submit the Agent transaction with expected revision 42.
4. Receive `STALE_REVISION`; no partial edit or new revision occurs.
5. Request a fresh Snapshot, reconsider the human change, and create a new
   transaction only if the intent remains valid.

Expected result: human and Agent operations retain identical optimistic
concurrency, lock, and atomicity semantics.
