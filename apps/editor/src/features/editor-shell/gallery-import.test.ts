import { createEmptyProject, type DraftingObject } from "@icm/model";
import { describe, expect, it } from "vitest";

import {
  applyProjectCopyPlacement,
  planProjectCopyPlacement,
} from "../clipboard/project-copy";
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

  it("is placed on a coarser canvas by making the canvas's grid fine enough to hold it", () => {
    // Drawn on grid 1, as Project Code drawings with [65, 47] are.
    const source = createEmptyProject("fine", "Fine");
    const drawn = source.documents[0]!;
    drawn.presentation.grid = 1;
    drawn.instances.push({
      id: "R1",
      reference: "R1",
      symbolId: "resistor",
      placement: { position: { x: 65, y: 47 }, rotation: 0, mirror: "none" },
      netlist: {
        binding: { kind: "primitive", deviceClass: "resistor" },
        parameters: { value: "1k" },
      },
    });
    const target = createEmptyProject("canvas", "Canvas");
    const canvas = target.documents[0]!;
    expect(canvas.presentation.grid).toBe(10);
    const drawing = captureGalleryDrawing(source)!;
    const plan = planProjectCopyPlacement(
      target,
      canvas,
      drawing.clipboard,
      { x: 200, y: 100 },
      1,
    );
    expect(plan.adoptedGrid).toBe(1);
    const placed = applyProjectCopyPlacement(plan).documents[0]!;
    expect(placed.presentation.grid).toBe(1);
    expect(placed.instances).toHaveLength(1);
    // Nothing moved off where the drawing put it.
    const { x, y } = placed.instances[0]!.placement!.position;
    expect([x - 200, y - 100]).toEqual([65, 47]);
  });

  it("makes the canvas only as fine as the drawing needs", () => {
    const source = createEmptyProject("five", "Five");
    const drawn = source.documents[0]!;
    drawn.presentation.grid = 5;
    drawn.instances.push({
      id: "R1",
      reference: "R1",
      symbolId: "resistor",
      placement: { position: { x: 65, y: 45 }, rotation: 0, mirror: "none" },
      netlist: {
        binding: { kind: "primitive", deviceClass: "resistor" },
        parameters: { value: "1k" },
      },
    });
    const target = createEmptyProject("canvas", "Canvas");
    const plan = planProjectCopyPlacement(
      target,
      target.documents[0]!,
      captureGalleryDrawing(source)!.clipboard,
      { x: 200, y: 100 },
      1,
    );
    expect(plan.adoptedGrid).toBe(5);
  });
});
