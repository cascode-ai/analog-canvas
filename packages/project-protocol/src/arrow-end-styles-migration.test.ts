import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  DraftingObjectSchema,
  createEmptyProject,
} from "@icm/model";
import { describe, expect, it } from "vitest";
import { parseProject, serializeProject } from "./index.js";

const arrow = {
  id: "arrow",
  kind: "arrow" as const,
  locked: false,
  zIndex: 0,
  anchor: { kind: "free" as const, position: { x: 0, y: 0 } },
  from: { kind: "free" as const, position: { x: 0, y: 0 } },
  to: { kind: "free" as const, position: { x: 100, y: 0 } },
};
describe("schema 55 independent arrow endpoint styles", () => {
  it("upgrades schema 54 without changing legacy arrows or creating overrides", () => {
    const project = createEmptyProject("arrows", "Arrows");
    project.documents[0]!.drafting = {
      objects: [
        arrow,
        {
          ...arrow,
          id: "open",
          styleOverride: {
            arrowHead: "open",
            arrowHeadAt: "both",
            arrowHeadScale: 1.25,
          },
        },
        {
          ...arrow,
          id: "outline",
          outline: { width: 30 },
          styleOverride: { arrowHeadAt: "start" },
        },
      ],
    };
    const previous = { ...project, schemaVersion: 54 };
    expect(parseProject(JSON.stringify(previous))).toEqual({
      ...previous,
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    });
  });
  it("round-trips every independent endpoint style without byte drift", () => {
    const styles = [
      "small-arrow",
      "medium-arrow",
      "large-arrow",
      "dot",
      "none",
      "open-arrow",
    ] as const;
    const project = createEmptyProject("arrows", "Arrows");
    project.documents[0]!.drafting = {
      objects: styles.flatMap((arrowStart) =>
        styles.map((arrowEnd) => ({
          ...arrow,
          id: `${arrowStart}-${arrowEnd}`,
          styleOverride: { arrowStart, arrowEnd },
        })),
      ),
    };
    const text = serializeProject(project);
    expect(parseProject(text)).toEqual(project);
    expect(serializeProject(parseProject(text))).toBe(text);
  });
  it("rejects unsupported values and endpoint styling on non-arrow objects", () => {
    for (const styleOverride of [{ arrowStart: "tiny" }, { arrowEnd: 1 }])
      expect(
        DraftingObjectSchema.safeParse({ ...arrow, styleOverride }).success,
      ).toBe(false);
    for (const styleOverride of [
      { arrowStart: "dot" },
      { arrowEnd: "large-arrow" },
    ])
      expect(
        DraftingObjectSchema.safeParse({
          id: "line",
          kind: "construction-line",
          locked: false,
          zIndex: 0,
          anchor: arrow.anchor,
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
          ],
          lineStyle: "solid",
          styleOverride,
        }).success,
      ).toBe(false);
  });
});
