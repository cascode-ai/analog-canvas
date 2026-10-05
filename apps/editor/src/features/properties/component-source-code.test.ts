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
  it("retains a resolved PDK wrapper when another part blocks the Cell", async () => {
    const { createLibraryExampleProject } =
      await import("../../examples/library-examples");
    const { planNetlistProcess } =
      await import("../netlist-export/netlist-process");
    const { createNetlistExportProfile } =
      await import("../netlist-export/netlist-process-presets");
    const { executeProjectTransaction } = await import("@icm/edit-engine");
    const project = createLibraryExampleProject("common-source-amplifier")!;
    const changed = executeProjectTransaction(project, {
      transactionId: "pdk",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: planNetlistProcess(project, createNetlistExportProfile("sky130")),
    });
    if (!changed.ok) throw Error(changed.error.message);
    const document = changed.project.documents[0]!;
    const mos = document.instances.find((i) => i.symbolId === "nmos")!;
    const before = componentSourceCode(
      changed.project,
      document.id,
      mos.id,
      resolver,
    );
    expect(before.exact).toBe(true);
    document.instances.push({
      id: "unfinished",
      reference: "Rbroken",
      symbolId: "resistor",
      placement: null,
    });
    const after = componentSourceCode(
      changed.project,
      document.id,
      mos.id,
      resolver,
    );
    expect(after.code).toBe(before.code);
    expect(after.exact).toBe(false);
  });
  it.each([
    ["vcvs", "E1", "gain", "1", "<unconnected:CTRL+> <unconnected:CTRL->"],
    ["vccs", "G1", "gm", "1m", "<unconnected:CTRL+> <unconnected:CTRL->"],
    ["cccs", "F1", "gain", "1", "<select-voltage-source>"],
    ["ccvs", "H1", "rm", "1k", "<select-voltage-source>"],
  ] as const)(
    "previews an incomplete %s without throwing",
    (symbolId, reference, parameter, value, missingControl) => {
      const project = createEmptyProject("project", "Project");
      const document = project.documents[0]!;
      document.instances.push({
        id: reference,
        symbolId,
        placement: null,
        reference,
        netlist: { parameters: { [parameter]: value } },
      });
      const preview = componentSourceCode(
        project,
        document.id,
        reference,
        resolver,
      );
      expect(preview.exact).toBe(false);
      expect(preview.code).toContain(missingControl);
      expect(preview.note).toContain("placeholders");
    },
  );
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

  it("calls a T-coil's own subcircuit, even before it is wired", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    document.instances.push({
      id: "X1",
      symbolId: "tcoil",
      placement: null,
      reference: "X1",
      netlist: { parameters: { cb: "1p", k: "0.5", l1: "1n", l2: "2n" } },
    });

    const preview = componentSourceCode(project, document.id, "X1", resolver);
    expect(preview.exact).toBe(false);
    expect(preview.code).toBe(
      "X1 <unconnected:1> <unconnected:2> <unconnected:3> tcoil l1=1n l2=2n k=0.5 cb=1p",
    );
    expect(preview.note).not.toContain("Subcircuit template");
  });
});
