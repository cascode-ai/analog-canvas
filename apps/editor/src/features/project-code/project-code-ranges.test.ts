import { createEmptyDocument, createEmptyProject } from "@icm/model";
import { describe, expect, it } from "vitest";

import { formatProjectCode } from "./project-code";
import { projectCodeInstanceRanges } from "./project-code-ranges";

function twoCells() {
  const project = createEmptyProject("project", "Project", "top");
  const child = createEmptyDocument("child", "Child");
  project.documents.push(child);
  for (const [cell, x] of [
    [project.documents[0]!, 0],
    [child, 200],
  ] as const)
    cell.instances.push(
      {
        id: "R1",
        reference: "R1",
        symbolId: "resistor",
        placement: { position: { x, y: 0 }, rotation: 0, mirror: "none" },
        netlist: { parameters: { value: "1k" } },
      },
      {
        id: "C1",
        reference: "C1",
        symbolId: "capacitor",
        placement: { position: { x, y: 100 }, rotation: 0, mirror: "none" },
        netlist: { parameters: { value: "1p" } },
      },
    );
  return formatProjectCode(project);
}

describe("Project Code ranges", () => {
  it("finds a selected part's whole object in its own Cell", () => {
    const source = twoCells();
    const [range] = projectCodeInstanceRanges(source, "child", ["R1"]);
    const text = source.slice(range!.from, range!.to);
    expect(JSON.parse(text)).toMatchObject({ id: "R1" });
    // The same id in the top Cell is a different part, earlier in the text.
    const [top] = projectCodeInstanceRanges(source, "top", ["R1"]);
    expect(top!.from).toBeLessThan(range!.from);
    expect(JSON.parse(source.slice(top!.from, top!.to))).toMatchObject({
      id: "R1",
    });
  });

  it("returns one range per selected part and none for text it cannot find", () => {
    const source = twoCells();
    expect(projectCodeInstanceRanges(source, "top", ["R1", "C1"])).toHaveLength(
      2,
    );
    expect(projectCodeInstanceRanges(source, "top", ["R9"])).toEqual([]);
    expect(projectCodeInstanceRanges(source, "nowhere", ["R1"])).toEqual([]);
    expect(projectCodeInstanceRanges("{ not json", "top", ["R1"])).toEqual([]);
  });
});
