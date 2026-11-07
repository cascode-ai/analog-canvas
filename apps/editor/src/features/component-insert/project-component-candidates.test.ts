import { describe, expect, it } from "vitest";
import { createEmptyProject } from "@icm/model";
import { withProjectComponentDefinitions } from "@icm/symbols";

import { projectComponentInsertCandidates } from "./project-component-candidates";

describe("the Project's components in Insert", () => {
  it("does not offer a used built-in again beside its Library tile", () => {
    // Placing a Resistor keeps a copy of its definition in the Project; the
    // Library tile already places it, and two tiles shared one test id.
    const project = createEmptyProject("p", "P", "main");
    project.documents[0]!.instances.push({
      id: "r1",
      reference: "R1",
      symbolId: "resistor",
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    });
    const captured = withProjectComponentDefinitions(project);
    expect(
      captured.componentDefinitions?.map((item) => item.symbol.id),
    ).toContain("resistor");
    expect(projectComponentInsertCandidates(captured)).toEqual([]);
  });

  it("still offers a component of the Project's own", () => {
    const project = withProjectComponentDefinitions(
      createEmptyProject("p", "P", "main"),
    );
    const resistor = withProjectComponentDefinitions({
      ...project,
      documents: [
        {
          ...project.documents[0]!,
          instances: [
            {
              id: "r1",
              reference: "R1",
              symbolId: "resistor",
              placement: null,
            },
          ],
        },
      ],
    }).componentDefinitions!.find((item) => item.symbol.id === "resistor")!;
    const own = {
      ...resistor,
      symbol: { ...resistor.symbol, id: "my-resistor", name: "My Resistor" },
    };
    const candidates = projectComponentInsertCandidates({
      componentDefinitions: [resistor, own],
      externalSubcircuitDefinitions: [],
    });
    expect(candidates.map((item) => item.symbol.id)).toEqual(["my-resistor"]);
  });
});
