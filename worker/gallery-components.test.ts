import { describe, expect, it } from "vitest";
import { createEmptyProject, type CircuitProject } from "@icm/model";

import {
  GALLERY_COMPONENT_RANGES,
  componentRangeSql,
  galleryComponentCount,
  requestedComponentRanges,
} from "./gallery-components";

type Instance = CircuitProject["documents"][number]["instances"][number];

function drawing(symbolIds: readonly (string | [string, "undrawn"])[]) {
  const project = createEmptyProject("parts", "Parts");
  project.documents[0]!.instances = symbolIds.map((entry, index) => {
    const [symbolId, drawn] = Array.isArray(entry)
      ? [entry[0], false]
      : [entry, true];
    return {
      id: `I${index}`,
      symbolId,
      placement: drawn
        ? {
            position: { x: 40 * index, y: 0 },
            rotation: 0,
            mirror: "none",
          }
        : null,
    } as Instance;
  });
  return project;
}

describe("the size of a Gallery circuit", () => {
  it("counts parts, not the markers that name Nets", () => {
    expect(
      galleryComponentCount(
        drawing([
          "nmos",
          "pmos",
          "resistor",
          "opamp",
          "and-gate",
          "voltage-source",
          "ideal-switch",
          "depletion-nmos",
          "hierarchical-symbol-0123456789abcdef",
          "port",
          "port-filled",
          "ground",
          "vdd-port",
        ]),
      ),
    ).toBe(9);
  });

  it("leaves out parts the sheet does not draw and other Cells", () => {
    const project = drawing(["resistor", ["capacitor", "undrawn"]]);
    project.documents.push({
      ...structuredClone(project.documents[0]!),
      id: "cell-b",
    });
    expect(galleryComponentCount(project)).toBe(1);
  });

  it("reads the sizes a request names, in order, ignoring unknown ones", () => {
    expect(
      requestedComponentRanges(["26-", "bogus", "0-5"]).map(
        (range) => range.key,
      ),
    ).toEqual(["0-5", "26-"]);
    expect(requestedComponentRanges("0-5")).toEqual([]);
    expect(GALLERY_COMPONENT_RANGES.map((range) => range.key)).toEqual([
      "0-5",
      "6-10",
      "11-15",
      "16-25",
      "26-",
    ]);
    // The sizes meet without a gap or an overlap.
    GALLERY_COMPONENT_RANGES.slice(1).forEach((range, index) =>
      expect(range.min).toBe(GALLERY_COMPONENT_RANGES[index]!.max! + 1),
    );
    expect(
      componentRangeSql(
        "e.component_count",
        requestedComponentRanges(["6-10", "26-"]),
      ),
    ).toEqual({
      sql: "(e.component_count BETWEEN ? AND ? OR e.component_count >= ?)",
      bindings: [6, 10, 26],
    });
  });
});
