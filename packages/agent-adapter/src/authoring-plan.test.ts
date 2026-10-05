import { describe, expect, it } from "vitest";
import { planActions } from "./authoring-plan.js";
import { testSnapshot } from "./test-support/snapshot-fixture.js";

/** Plan a list that must not need the Document: reading it fails the test. */
function planBlind(actions: unknown[]) {
  let next = 0;
  return planActions(actions, {
    allocateId: (prefix) => `${prefix}-${++next}`,
    snapshot: () => {
      throw new Error("read the Document");
    },
    maxEditsPerTransaction: () => 64,
  });
}

describe("planning an action list", () => {
  it("sends Cells placed without IDs or orientation as one native batch, without the Document (#1301)", () => {
    const place = (x: number) => ({
      kind: "place-cell",
      childDocumentId: "child",
      placement: { position: { x, y: 0 } },
    });
    const plan = planBlind([place(0), place(100)]);
    expect(plan).toMatchObject({ kind: "send", readSnapshot: false });
    if (plan.kind !== "send") throw new Error(plan.kind);
    const batch = plan.payload.command as {
      kind: string;
      commands: { instanceId: string; placement: unknown }[];
    };
    expect(batch.kind).toBe("batch");
    expect(batch.commands.map((item) => item.placement)).toEqual([
      { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      { position: { x: 100, y: 0 }, rotation: 0, mirror: "none" },
    ]);
    expect(new Set(batch.commands.map((item) => item.instanceId)).size).toBe(2);
  });

  it("sends wires between explicit IDs as one wire batch, without the Document", () => {
    const from = {
      kind: "pin",
      instance: { kind: "instance", id: "instance-1" },
      pin: "G",
    };
    const plan = planBlind([
      {
        kind: "connect",
        from,
        to: {
          kind: "pin",
          instance: { kind: "instance", id: "instance-2" },
          pin: "1",
        },
      },
      { kind: "connect", from, to: { kind: "point", x: 220, y: 200 } },
    ]);
    expect(plan).toMatchObject({
      kind: "send",
      readSnapshot: false,
      payload: {
        wireIntent: [
          { from: { endpoint: { instanceId: "instance-1", pinName: "G" } } },
          { to: { kind: "free", point: { x: 220, y: 200 } } },
        ],
      },
    });
  });

  it("sends a Cell's Pin layout by name as its command, for the editor to plan without the client reading the Document (#1320)", () => {
    const action = {
      kind: "set-cell-symbol-pins",
      pins: [
        { name: "bl", side: "east" },
        { name: "blb", side: "west", offset: 0 },
      ],
    };
    expect(planBlind([action])).toMatchObject({
      kind: "send",
      readSnapshot: false,
      payload: { command: action },
    });
    // A side the block has not is refused before anything is sent.
    expect(
      planBlind([
        { kind: "set-cell-symbol-pins", pins: [{ name: "bl", side: "up" }] },
      ]),
    ).toMatchObject({ kind: "refused", actionIndex: 0, actionKind: "schema" });
  });

  it("reads the Document for a list that names parts by Reference", () => {
    const snapshot = testSnapshot();
    let reads = 0;
    const plan = planActions(
      [
        {
          kind: "set-reference",
          target: { kind: "instance", reference: "M1" },
          reference: "M2",
        },
      ],
      {
        allocateId: (prefix) => `${prefix}-1`,
        snapshot: () => {
          reads++;
          return snapshot;
        },
        maxEditsPerTransaction: () => 64,
      },
    );
    expect(reads).toBe(1);
    expect(plan).toMatchObject({ kind: "send", readSnapshot: true });
  });
});
