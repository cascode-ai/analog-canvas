import { createEmptyProject, deriveStableId } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { componentSourceCode } from "./component-source-code";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function claimNet(
  document: ReturnType<typeof createEmptyProject>["documents"][number],
  netId: string,
  name: string,
): void {
  const annotationId = deriveStableId("label", document.id, netId);
  document.annotations.push({
    id: annotationId,
    kind: "net-label",
    binding: { kind: "net-name", netId },
    netId,
    anchor: { kind: "free", position: { x: 0, y: 0 } },
    alignment: "start",
    rotation: 0,
    locked: false,
  });
  document.connectivityEvidence.push({
    id: deriveStableId("claim", document.id, netId),
    kind: "name-claim",
    netId,
    name,
    owner: { kind: "net-label", annotationId },
    scope: "local",
  });
}

describe("component source code", () => {
  it("shows the exact emitted card for an exportable component", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: null,
      reference: "R1",
      netlist: {
        binding: { kind: "primitive", deviceClass: "resistor" },
        parameters: { value: "10k" },
      },
    });
    document.nets.push(
      {
        id: "net-in",
        terminals: [{ instanceId: "R1", pinName: "1" }],
      },
      {
        id: "net-out",
        terminals: [{ instanceId: "R1", pinName: "2" }],
      },
    );
    claimNet(document, "net-in", "VIN");
    claimNet(document, "net-out", "VOUT");

    expect(componentSourceCode(project, document.id, "R1", resolver)).toEqual({
      code: "R1 VIN VOUT 10k",
      exact: true,
      note: null,
    });
  });

  it("shows unresolved transistor facts as visible placeholders", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    document.instances.push({
      id: "M1",
      symbolId: "nmos",
      placement: null,
      reference: "M1",
      netlist: { parameters: { w: "1u", l: "150n" } },
    });

    const preview = componentSourceCode(project, document.id, "M1", resolver);
    expect(preview.exact).toBe(false);
    expect(preview.code).toContain("M1 <unconnected:D> <unconnected:G>");
    expect(preview.code).toContain("<model>");
    expect(preview.code).toContain("l=150n");
    expect(preview.code).toContain("w=1u");
  });

  it("uses an X-card template for a visual Analog Block", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    document.instances.push({
      id: "X1",
      symbolId: "opamp",
      placement: null,
    });

    const preview = componentSourceCode(project, document.id, "X1", resolver);
    expect(preview.exact).toBe(false);
    expect(preview.code).toMatch(/^X1 /u);
    expect(preview.code).toContain("<subcircuit-model>");
    expect(preview.note).toContain("Subcircuit template");
  });
});
