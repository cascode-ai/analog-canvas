import { createEmptyDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { proposeEdgeAlignmentEdits } from "./align-instances";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function fixture() {
  const document = createEmptyDocument("doc", "Align");
  document.instances.push(
    {
      id: "R1",
      symbolId: "resistor",
      placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
      netlist: { reference: "R1", parameters: {} },
    },
    {
      id: "R2",
      symbolId: "resistor",
      placement: { position: { x: 240, y: 180 }, rotation: 0, mirror: "none" },
      netlist: { reference: "R2", parameters: {} },
    },
    {
      id: "R3",
      symbolId: "resistor",
      placement: { position: { x: 300, y: 140 }, rotation: 0, mirror: "none" },
      netlist: { reference: "R3", parameters: {} },
    },
  );
  return document;
}

describe("proposeEdgeAlignmentEdits", () => {
  it("aligns identical symbols exactly on the shared edge", () => {
    const document = fixture();
    const edits = proposeEdgeAlignmentEdits(
      document,
      resolver,
      ["R1", "R2", "R3"],
      "left",
    );
    // Identical symbols share bbox metrics, so aligning the left edge is
    // exactly equalizing x; R1 already sits at the minimum.
    expect(edits).toEqual([
      { kind: "move_instance", instanceId: "R2", position: { x: 100, y: 180 } },
      { kind: "move_instance", instanceId: "R3", position: { x: 100, y: 140 } },
    ]);
  });

  it("aligns tops moving only along y", () => {
    const document = fixture();
    const edits = proposeEdgeAlignmentEdits(
      document,
      resolver,
      ["R1", "R2", "R3"],
      "top",
    );
    expect(edits).toEqual([
      { kind: "move_instance", instanceId: "R2", position: { x: 240, y: 100 } },
      { kind: "move_instance", instanceId: "R3", position: { x: 300, y: 100 } },
    ]);
  });

  it("centers on the average and keeps every move on the grid", () => {
    const document = fixture();
    const edits = proposeEdgeAlignmentEdits(
      document,
      resolver,
      ["R1", "R2", "R3"],
      "v-center",
    );
    // Average center y = (100+180+140)/3 = 140.
    expect(edits).toEqual([
      { kind: "move_instance", instanceId: "R1", position: { x: 100, y: 140 } },
      { kind: "move_instance", instanceId: "R2", position: { x: 240, y: 140 } },
    ]);
    for (const edit of edits) {
      if (edit.kind !== "move_instance") continue;
      expect(edit.position.x % document.presentation.grid).toBe(0);
      expect(edit.position.y % document.presentation.grid).toBe(0);
    }
  });

  it("returns nothing for fewer than two placed instances", () => {
    const document = fixture();
    expect(
      proposeEdgeAlignmentEdits(document, resolver, ["R1"], "left"),
    ).toEqual([]);
  });
});
