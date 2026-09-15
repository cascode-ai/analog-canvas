import {
  createEmptyProject,
  createRoutePath,
  CURRENT_PROJECT_SCHEMA_VERSION,
} from "@icm/model";
import { describe, expect, it } from "vitest";
import { parseProject, serializeProject } from "./index.js";

function projectWithRoute() {
  const project = createEmptyProject("wire-style", "Wire style");
  const document = project.documents[0]!;
  document.nets.push({ id: "net", terminals: [] });
  document.junctions.push(
    { id: "J1", netId: "net", position: { x: 0, y: 0 } },
    { id: "J2", netId: "net", position: { x: 100, y: 0 } },
  );
  document.routes.push(
    createRoutePath({
      id: "wire",
      netId: "net",
      start: { kind: "junction", junctionId: "J1" },
      end: { kind: "junction", junctionId: "J2" },
      bends: [],
      modes: ["manual"],
      styleOverride: { color: "#123456", arrow: "end" },
    }),
  );
  return project;
}

describe("schema 56 electrical Route line styles", () => {
  it("upgrades schema 55 without changing existing Route facts or adding styling", () => {
    const previous = { ...projectWithRoute(), schemaVersion: 55 };
    expect(parseProject(JSON.stringify(previous))).toEqual({
      ...previous,
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    });
  });

  it.each(["solid", "dashed", "dotted"] as const)(
    "round-trips %s with color and arrow",
    (lineStyle) => {
      const project = projectWithRoute();
      project.documents[0]!.routes[0]!.styleOverride!.lineStyle = lineStyle;
      const text = serializeProject(project);
      expect(parseProject(text)).toEqual(project);
      expect(serializeProject(parseProject(text))).toBe(text);
    },
  );

  it("rejects invalid styles at the project boundary", () => {
    const project = projectWithRoute();
    const raw = JSON.parse(JSON.stringify(project));
    raw.documents[0].routes[0].styleOverride.lineStyle = "custom";
    expect(() => parseProject(JSON.stringify(raw))).toThrow();
  });
});
