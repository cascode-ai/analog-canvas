import { createEmptyProject, type CircuitProject } from "@icm/model";
import { describe, expect, it } from "vitest";

import { createDraftNetlistPreview } from "./draft-preview.js";
import { createDesignNetlistExport } from "./export.js";

function parts(
  entries: readonly [id: string, symbolId: string, x: number][],
): CircuitProject {
  const project = createEmptyProject("draft", "Draft");
  for (const [id, symbolId, x] of entries)
    project.documents[0]!.instances.push({
      id,
      reference: id,
      symbolId,
      placement: { position: { x, y: 0 }, rotation: 0, mirror: "none" },
    });
  return project;
}

describe("draft netlist preview", () => {
  it("prints parts as soon as they are placed, with ? for what is missing", () => {
    const project = parts([
      ["R1", "resistor", 0],
      ["R2", "resistor", 200],
    ]);
    expect(createDesignNetlistExport(project).status).toBe("blocked");
    const draft = createDraftNetlistPreview(project)!;
    expect(draft.text.split("\n")[0]).toBe(
      "* Draft: each ? is something the drawing does not say yet",
    );
    const lines = draft.text.split("\n");
    expect(lines).toContain("R1 ? ? ?");
    expect(lines).toContain("R2 ? ? ?");
    // Each flagged card is where a finding points, and its text is the card.
    expect(draft.flagged.map((card) => card.instanceId).sort()).toEqual([
      "R1",
      "R2",
    ]);
    for (const card of draft.flagged)
      expect(draft.text.slice(card.startOffset, card.endOffset)).toMatch(
        new RegExp(`^${card.instanceId} `, "u"),
      );
  });

  it("prints ? for a missing model and names a part with no netlist form", () => {
    const project = parts([
      ["M1", "nmos", 0],
      ["D1", "delay-cell", 200],
    ]);
    const draft = createDraftNetlistPreview(project)!;
    const card = draft.text.split("\n").find((line) => line.startsWith("M1 "));
    expect(card?.split(/\s+/u)).toContain("?");
    expect(draft.text).toMatch(/^\* \? D1: .+$/mu);
    expect(draft.flagged.map((item) => item.instanceId)).toContain("M1");
  });

  it("writes the draft line as a Spectre comment in Spectre", () => {
    const draft = createDraftNetlistPreview(parts([["R1", "resistor", 0]]), {
      format: "spectre",
    })!;
    expect(draft.text.startsWith("// Draft: each ?")).toBe(true);
    expect(draft.text).toContain("R1 (? ?) resistor r=?");
  });
});
