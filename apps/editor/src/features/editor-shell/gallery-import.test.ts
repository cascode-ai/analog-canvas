import { createEmptyProject, type DraftingObject } from "@icm/model";
import { describe, expect, it } from "vitest";

import { captureGalleryDrawing } from "./gallery-import";

const rectangle = (id: string, fillColor: string): DraftingObject =>
  ({
    id,
    kind: "rectangle",
    locked: false,
    zIndex: 0,
    layer: "background",
    anchor: { kind: "free", position: { x: 200, y: 200 } },
    center: { x: 200, y: 200 },
    width: 80,
    height: 40,
    rotation: 0,
    lineStyle: "solid",
    styleOverride: { fillColor },
  }) as DraftingObject;

describe("a Gallery drawing to insert (2026-10-17)", () => {
  it("leaves out a white mask an older entry holds and keeps a pale panel", () => {
    const project = createEmptyProject("gallery", "Gallery");
    const document = project.documents[0]!;
    document.instances.push({
      id: "R1",
      reference: "R1",
      symbolId: "resistor",
      placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
      netlist: {
        binding: { kind: "primitive", deviceClass: "resistor" },
        parameters: { value: "1k" },
      },
    });
    document.drafting = {
      objects: [rectangle("mask", "#ffffff"), rectangle("panel", "#f0fdfa")],
    };
    const drawing = captureGalleryDrawing(project);
    expect(drawing?.coversLeftOut).toBe(1);
    expect(
      drawing?.clipboard.draftingObjects.map((object) => object.id),
    ).toEqual(["panel"]);
  });
});
