import { createEmptyProject } from "@icm/model";
import { describe, expect, it } from "vitest";

import { parseProjectWithMetadata } from "./load.js";

function legacyProject() {
  const project = createEmptyProject("project", "Project");
  project.externalSubcircuitDefinitions.push({
    id: "sky-nfet",
    name: "sky130_fd_pr__nfet_01v8",
    terminals: ["D", "G", "S", "B"].map((name, index) => ({
      id: `terminal-${index}`,
      name,
      direction: "passive",
    })),
    formalParameters: [],
    interfaceStatus: "declared",
  });
  project.documents[0]!.instances.push({
    id: "legacy-mos",
    symbolId: "nmos",
    placement: null,
    reference: "X1",
    netlist: {
      binding: { kind: "external-subcircuit", definitionId: "sky-nfet" },
      parameters: { w: "1u", l: "150n" },
    },
  });
  return project;
}

describe("legacy reviewed external reference repair", () => {
  it("restores the authored device prefix for the exact old UI shape", () => {
    const opened = parseProjectWithMetadata(JSON.stringify(legacyProject()));
    expect(opened.migrated).toBe(false);
    expect(opened.project.documents[0]!.instances[0]!.reference).toBe("M1");
  });

  it("does not rewrite when the repaired reference would collide", () => {
    const project = legacyProject();
    project.documents[0]!.instances.push({
      id: "existing-m1",
      symbolId: "resistor",
      placement: null,
      reference: "M1",
      netlist: { parameters: { value: "1k" } },
    });
    const opened = parseProjectWithMetadata(JSON.stringify(project));
    expect(opened.project.documents[0]!.instances[0]!.reference).toBe("X1");
  });
});
