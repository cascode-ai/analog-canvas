import { createRoutePath } from "@icm/model";
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
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "R2",
        symbolId: "resistor",
        placement: {
          position: { x: 300, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    document.nets.push({
      id: "n1",

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
      createRoutePath({
        id: "wire-left",
        netId: "n1",
        start: { kind: "terminal", instanceId: "R1", pinName: "1" },
        end: { kind: "junction", junctionId: "J1" },
        bends: [],
        modes: ["manual"],
      }),
      createRoutePath({
        id: "wire-right",
        netId: "n1",
        start: { kind: "junction", junctionId: "J1" },
        end: { kind: "terminal", instanceId: "R2", pinName: "1" },
        bends: [],
        modes: ["manual"],
      }),
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

  it("carries an explicitly selected Junction using the same closure as the engine", () => {
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
    expect(plan.translatedJunctionIds).toEqual(["J1"]);
    expect(plan.fixedObjectIds).toEqual([]);
  });

  it("moves an explicitly selected anchored label independently but not twice with its host", () => {
    const document = createEmptyDocument("doc", "Doc");
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0,
        mirror: "none",
      },
    });
    document.annotations.push({
      id: "label-r1",
      kind: "instance-label",
      binding: { kind: "instance-reference", instanceId: "R1" },
      anchor: {
        kind: "object",
        objectId: "R1",
        localOffset: { x: 10, y: -20 },
        fallbackPosition: { x: 110, y: 80 },
      },
      alignment: "start",
      rotation: 0,
      locked: false,
    });

    const labelOnly = planSelectionMove(document, {
      instanceIds: [],
      routeIds: [],
      junctionIds: [],
      annotationIds: ["label-r1"],
      draftingIds: [],
    });
    expect(labelOnly.independentAnnotationIds).toEqual(["label-r1"]);
    expect(labelOnly.previewObjectIds).toContain("label-r1");

    const withHost = planSelectionMove(document, {
      instanceIds: ["R1"],
      routeIds: [],
      junctionIds: [],
      annotationIds: ["label-r1"],
      draftingIds: [],
    });
    expect(withHost.independentAnnotationIds).toEqual([]);
    expect(withHost.previewObjectIds).toEqual(
      expect.arrayContaining(["R1", "label-r1"]),
    );
  });
});
