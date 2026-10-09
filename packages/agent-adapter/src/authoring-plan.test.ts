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

  it("sends a label preset for the whole Cell or parts by ID as its command, without the Document (#1350)", () => {
    expect(
      planBlind([{ kind: "apply-label-preset", preset: "textbook" }]),
    ).toMatchObject({
      kind: "send",
      readSnapshot: false,
      payload: { command: { kind: "apply-label-preset", preset: "textbook" } },
    });
    expect(
      planBlind([
        {
          kind: "apply-label-preset",
          preset: "textbook",
          targets: [
            { kind: "instance", id: "instance-1" },
            { kind: "instance", id: "instance-2" },
          ],
        },
      ]),
    ).toMatchObject({
      kind: "send",
      readSnapshot: false,
      payload: {
        command: {
          kind: "apply-label-preset",
          preset: "textbook",
          instanceIds: ["instance-1", "instance-2"],
        },
      },
    });
  });

  it("sends two power rails and a final focus as one batch, the focus after it (#1517)", () => {
    const rail = (name: string, y: number) => ({
      kind: "add-power-rail",
      name,
      start: { x: 0, y },
      end: { x: 400, y },
    });
    const fit = { kind: "focus", intent: { kind: "fit-document" } };
    expect(planBlind([rail("VDD", -200), rail("VSS", 400), fit])).toEqual({
      kind: "send",
      payload: {
        command: {
          kind: "batch",
          commands: [rail("VDD", -200), rail("VSS", 400)],
        },
      },
      actions: [rail("VDD", -200), rail("VSS", 400), fit],
      readSnapshot: false,
      actionIndexOf: expect.any(Function),
      naming: "if-unnamed",
      focus: [{ kind: "fit-document" }],
    });
    const extend = {
      kind: "extend-power-rail",
      routeId: "rail-1",
      start: { x: -100, y: -200 },
      end: { x: 500, y: -200 },
    };
    expect(planBlind([extend, rail("VSS", 400)])).toMatchObject({
      kind: "send",
      payload: { command: { kind: "batch", commands: [extend, {}] } },
    });
    // A focus before the rails still follows them; a refused batch item
    // names its action in the list.
    const plan = planBlind([fit, rail("VDD", -200), rail("VSS", 400)]);
    if (plan.kind !== "send") throw new Error(plan.kind);
    expect(plan.focus).toEqual([{ kind: "fit-document" }]);
    expect(plan.naming).toBe("override");
    expect(plan.actionIndexOf([{ parameters: { actionIndex: 1 } }])).toBe(2);
    // Focus alone changes nothing but the view.
    expect(planBlind([fit, fit])).toEqual({
      kind: "nothing",
      focus: [{ kind: "fit-document" }, { kind: "fit-document" }],
    });
  });

  it("keeps a focus with the list it follows when the list reads the Document or needs several calls (#1517)", () => {
    const snapshot = testSnapshot();
    const fit = { kind: "focus", intent: { kind: "fit-document" } };
    const plan = (actions: unknown[]) =>
      planActions(actions, {
        allocateId: (prefix) => `${prefix}-new`,
        snapshot: () => snapshot,
        maxEditsPerTransaction: () => 64,
      });
    expect(
      plan([
        {
          kind: "move",
          target: { kind: "instance", reference: "M1" },
          position: { x: 0, y: 0 },
        },
        fit,
      ]),
    ).toMatchObject({
      kind: "send",
      readSnapshot: true,
      payload: { command: { kind: "set-properties" } },
      focus: [{ kind: "fit-document" }],
    });
    // Placing and wiring are two calls; the focus goes with the last.
    expect(
      plan([
        {
          kind: "place-component",
          symbol: "resistor",
          id: "r-new",
          position: { x: 600, y: 300 },
        },
        fit,
        {
          kind: "connect",
          from: {
            kind: "pin",
            instance: { kind: "instance", id: "r-new" },
            pin: "1",
          },
          to: { kind: "pin", instance: "M1", pin: "G" },
        },
      ]),
    ).toMatchObject({
      kind: "split",
      transactions: 2,
      calls: [
        { actionIndices: [0], sends: "placement batch" },
        {
          actionIndices: [1, 2],
          actionKinds: ["connect", "focus"],
          sends: "wires",
        },
      ],
    });
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
