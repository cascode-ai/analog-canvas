import { describe, expect, it } from "vitest";
import { createEmptyProject } from "@icm/model";
import { parseProject, serializeProject } from "./index.js";

describe("drafting shape paint migration", () => {
  it("upgrades a schema-50 Project without changing authored content", () => {
    const current = createEmptyProject("p", "P");
    const previous = {
      ...current,
      schemaVersion: 50,
      name: "Preserve me",
    };

    const loaded = parseProject(JSON.stringify(previous));

    expect(loaded).toEqual({ ...previous, schemaVersion: 51 });
    expect(parseProject(serializeProject(loaded))).toEqual(loaded);
  });

  it("round-trips rectangle and circle fill and drafting planes", () => {
    const project = createEmptyProject("p", "P");
    const document = project.documents[0]!;
    document.drafting!.objects.push(
      {
        id: "rect",
        kind: "rectangle",
        locked: false,
        zIndex: 0,
        anchor: { kind: "free", position: { x: 20, y: 20 } },
        center: { x: 20, y: 20 },
        width: 40,
        height: 20,
        rotation: 0,
        lineStyle: "solid",
        layer: "background",
        styleOverride: { color: "#dc2626", fillColor: "#9ca3af" },
      },
      {
        id: "circle",
        kind: "circle",
        locked: false,
        zIndex: 1,
        anchor: { kind: "free", position: { x: 80, y: 20 } },
        center: { x: 80, y: 20 },
        radius: 10,
        lineStyle: "solid",
        layer: "foreground",
        styleOverride: { color: "#2563eb", fillColor: "#059669" },
      },
    );

    expect(parseProject(serializeProject(project))).toEqual(project);
  });
});
