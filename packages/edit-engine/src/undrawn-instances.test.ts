import { createEmptyProject } from "@icm/model";
import { describe, expect, it } from "vitest";

import { planUndrawnInstancePlacements } from "./undrawn-instances.js";

function documentWith(
  instances: { id: string; drawn: boolean }[],
): ReturnType<typeof createEmptyProject>["documents"][number] {
  const project = createEmptyProject("undrawn", "Undrawn");
  const document = project.documents[0]!;
  document.instances.push(
    ...instances.map(({ id, drawn }) => ({
      id,
      symbolId: "resistor",
      placement: drawn
        ? {
            position: { x: 100, y: 100 },
            rotation: 0 as const,
            mirror: "none" as const,
          }
        : null,
    })),
  );
  return document;
}

describe("undrawn Instance repair", () => {
  it("plans nothing when the drawing already shows every Instance", () => {
    expect(
      planUndrawnInstancePlacements(documentWith([{ id: "R1", drawn: true }])),
    ).toEqual([]);
  });

  it("draws off-sheet Instances on the Document grid below the drawing", () => {
    const document = documentWith([
      { id: "R1", drawn: true },
      { id: "R2", drawn: false },
      { id: "R3", drawn: false },
    ]);

    const placements = planUndrawnInstancePlacements(document);

    expect(placements.map(({ instanceId }) => instanceId)).toEqual([
      "R2",
      "R3",
    ]);
    for (const { placement } of placements) {
      expect(placement.position.x % document.presentation.grid).toBe(0);
      expect(placement.position.y % document.presentation.grid).toBe(0);
      // Below the Instance that is already drawn, so nothing lands on top of it.
      expect(placement.position.y).toBeGreaterThan(100);
    }
    // Deterministic: the same Document plans the same drawing.
    expect(planUndrawnInstancePlacements(document)).toEqual(placements);
  });
});
