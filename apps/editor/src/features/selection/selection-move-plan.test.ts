import { describe, expect, it } from "vitest";

import { createEmptyDocument } from "@icm/model";

import { planSelectionMove } from "./selection-move-plan";

describe("selection move plan", () => {
  it("keeps an internal wire, its Junction, and anchored labels in one visual closure", () => {
    const document = createEmptyDocument("doc", "Doc");
    document.instances.push(
      {
        id: "R1",
        symbolId: "resistor",
        properties: {},
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "R2",
        symbolId: "resistor",
        properties: {},
        placement: {
          position: { x: 300, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    document.nets.push({
      id: "n1",
      name: "n1",
      scope: "local",
      terminals: [
        { instanceId: "R1", pinName: "1" },
        { instanceId: "R2", pinName: "1" },
      ],
    });
    document.junctions.push({
      id: "J1",
      netId: "n1",
      position: { x: 200, y: 100 },
    });
    document.routes.push(
      {
        id: "wire-left",
        netId: "n1",
        from: { kind: "terminal", instanceId: "R1", pinName: "1" },
        to: { kind: "junction", junctionId: "J1" },
        waypoints: [],
        segmentModes: ["manual"],
      },
      {
        id: "wire-right",
        netId: "n1",
        from: { kind: "junction", junctionId: "J1" },
        to: { kind: "terminal", instanceId: "R2", pinName: "1" },
        waypoints: [],
        segmentModes: ["manual"],
      },
    );
    document.annotations.push({
      id: "label-r1",
      kind: "instance-label",
      content: { runs: [{ kind: "text", value: "R1" }] },
      alignment: "start",
      rotation: 0,
      locked: false,
      anchor: {
        kind: "object",
        objectId: "R1",
        localOffset: { x: 10, y: 10 },
        fallbackPosition: { x: 110, y: 110 },
      },
    });

    const plan = planSelectionMove(document, {
      instanceIds: ["R1", "R2"],
      routeIds: [],
      junctionIds: [],
      annotationIds: [],
      draftingIds: [],
    });

    expect(plan.intent).toBe("move-selection");
    expect(plan.translatedRouteIds).toEqual(["wire-left", "wire-right"]);
    expect(plan.translatedJunctionIds).toEqual(["J1"]);
    expect(plan.previewObjectIds).toEqual(
      expect.arrayContaining([
        "R1",
        "R2",
        "J1",
        "wire-left",
        "wire-right",
        "label-r1",
      ]),
    );
  });

  it("does not treat a selected boundary Junction as independently movable", () => {
    const document = createEmptyDocument("doc", "Doc");
    document.junctions.push({
      id: "J1",
      netId: "n1",
      position: { x: 100, y: 100 },
    });
    const plan = planSelectionMove(document, {
      instanceIds: [],
      routeIds: [],
      junctionIds: ["J1"],
      annotationIds: [],
      draftingIds: [],
    });
    expect(plan.intent).toBe("move-selection");
    expect(plan.translatedJunctionIds).toEqual([]);
    expect(plan.fixedObjectIds).toEqual(["J1"]);
  });
});
