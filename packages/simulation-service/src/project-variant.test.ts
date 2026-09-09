import { describe, expect, it } from "vitest";
import { createEmptyProject } from "@icm/model";

import { projectSimulationVariant } from "./project-variant.js";

function fixture() {
  const project = createEmptyProject("project", "Project", "tb");
  project.documents[0]!.instances.push({
    id: "R1",
    symbolId: "resistor",
    reference: "R1",
    placement: null,
    netlist: {
      binding: { kind: "primitive", deviceClass: "resistor" },
      parameters: { resistance: "1k" },
    },
  });
  project.simulationSetups.push({
    id: "setup",
    name: "Sweep",
    version: 3,
    input: {
      kind: "structured",
      rootDocumentId: "tb",
      analyses: [{ kind: "op" }],
      outputs: [],
      designVariables: [
        {
          id: "load",
          name: "RLOAD",
          value: "2k",
          bindings: [
            {
              documentId: "tb",
              instanceId: "R1",
              parameter: "resistance",
            },
          ],
        },
      ],
      runPlan: {
        mode: "sweep",
        axes: [{ kind: "variable", variableId: "load", values: ["1k", "4k"] }],
      },
      environment: { profileId: "test" },
    },
  });
  return project;
}

describe("Project simulation Design Variables", () => {
  it("projects nominal values without mutating the Project", () => {
    const project = fixture();
    const projected = projectSimulationVariant(project, "setup");
    expect(projected).toMatchObject({ ok: true });
    if (!projected.ok) return;
    expect(
      projected.project.documents[0]!.instances[0]!.netlist!.parameters,
    ).toEqual({ resistance: "2k" });
    expect(project.documents[0]!.instances[0]!.netlist!.parameters).toEqual({
      resistance: "1k",
    });
  });

  it("applies a variable point before an advanced exact override", () => {
    const project = fixture();
    const projected = projectSimulationVariant(project, "setup", {
      variables: [{ variableId: "load", value: "4k" }],
      parameters: [
        {
          documentId: "tb",
          instanceId: "R1",
          parameter: "resistance",
          value: "8k",
        },
      ],
    });
    expect(projected).toMatchObject({ ok: true });
    if (!projected.ok) return;
    expect(
      projected.project.documents[0]!.instances[0]!.netlist!.parameters,
    ).toEqual({ resistance: "8k" });
  });

  it("returns a recoverable preparation cause for stale bindings", () => {
    const project = fixture();
    project.documents[0]!.instances[0]!.netlist!.parameters = {};
    expect(projectSimulationVariant(project, "setup")).toEqual({
      ok: false,
      code: "SIMULATION_VARIABLE_BINDING_PARAMETER_MISSING",
      message: "Design Variable parameter does not exist: R1.resistance",
    });
  });
});
