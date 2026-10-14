import { createEmptyProject } from "@icm/model";
import { describe, expect, it } from "vitest";

import { createDesignNetlistExport } from "./export.js";
import { designNetlistNetName } from "./net-export-name.js";

/** R1–R2 and R3–R4 are drawn apart but both named OUT; R1–R3 is unnamed. */
function namedApart() {
  const project = createEmptyProject("project", "Project");
  const document = project.documents[0]!;
  document.instances = ["R1", "R2", "R3", "R4"].map((id, index) => ({
    id,
    reference: id,
    symbolId: "resistor",
    placement: {
      position: { x: 100 + index * 100, y: 100 },
      rotation: 0 as const,
      mirror: "none" as const,
    },
    netlist: {
      binding: { kind: "primitive" as const, deviceClass: "resistor" as const },
      parameters: { value: "1k" },
    },
  }));
  const terminals = (...pins: string[]) =>
    pins.map((pin) => {
      const [instanceId, pinName] = pin.split(".");
      return { instanceId: instanceId!, pinName: pinName! };
    });
  document.nets = [
    { id: "net-a", terminals: terminals("R1.1", "R2.1") },
    { id: "net-b", terminals: terminals("R3.1", "R4.1") },
    { id: "net-c", terminals: terminals("R1.2", "R3.2") },
    { id: "net-d", terminals: terminals("R2.2", "R4.2") },
  ];
  document.connectivityEvidence.push(
    ...["net-a", "net-b"].map((netId, index) => ({
      id: `claim-${netId}`,
      kind: "name-claim" as const,
      netId,
      name: "OUT",
      owner: { kind: "net-label" as const, annotationId: `label-${index}` },
      scope: "local" as const,
    })),
  );
  return { project, documentId: document.id };
}

describe("the name a netlist writes a Net under (2026-10-14)", () => {
  it("is the name on that Net's cards, generated or drawn", () => {
    const { project, documentId } = namedApart();
    const result = createDesignNetlistExport(project);
    if (result.status !== "ready") throw new Error("export blocked");
    const name = (netId: string) =>
      designNetlistNetName(project, documentId, netId);
    expect(name("net-a")).toBe("OUT");
    expect(name("net-b")).toBe("OUT");
    const unnamed = name("net-c");
    expect(unnamed).toMatch(/^net\d+$/u);
    expect(result.file.text).toMatch(
      new RegExp(`^R1 OUT ${unnamed} 1k$`, "mu"),
    );
    expect(name("missing")).toBeNull();
  });
});
