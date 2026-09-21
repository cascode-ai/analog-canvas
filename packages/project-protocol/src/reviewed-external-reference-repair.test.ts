import {
  createEmptyProject,
  flattenRichText,
  semanticTextDocument,
} from "@icm/model";
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
    reference: "M1",
    netlist: {
      binding: { kind: "external-subcircuit", definitionId: "sky-nfet" },
      parameters: { w: "1u", l: "150n" },
    },
  });
  return project;
}

describe("reviewed external references on file open", () => {
  it("preserves the authored device name instead of adding an export prefix", () => {
    const opened = parseProjectWithMetadata(JSON.stringify(legacyProject()));
    expect(opened.migrated).toBe(true);
    expect(opened.project.documents[0]!.instances[0]!.reference).toBe("M1");
  });

  it("keeps bound display formatting and its authored name", () => {
    const project = legacyProject();
    project.documents[0]!.annotations.push({
      id: "legacy-mos-label",
      kind: "instance-label",
      binding: { kind: "instance-reference", instanceId: "legacy-mos" },
      formatOverride: semanticTextDocument("M1", "instance-label"),
      anchor: {
        kind: "object",
        objectId: "legacy-mos",
        localOffset: { x: 0, y: 0 },
        fallbackPosition: { x: 0, y: 0 },
      },
      alignment: "start",
      rotation: 0,
      locked: false,
    });

    const opened = parseProjectWithMetadata(JSON.stringify(project));
    const label = opened.project.documents[0]!.annotations[0]!;
    expect(opened.project.documents[0]!.instances[0]!.reference).toBe("M1");
    expect(flattenRichText(label.formatOverride!)).toBe("M1");
  });

  it("keeps distinct M1 and XM1 names intact", () => {
    const project = legacyProject();
    project.documents[0]!.instances.push({
      id: "existing-xm1",
      symbolId: "resistor",
      placement: null,
      reference: "XM1",
      netlist: { parameters: { value: "1k" } },
    });
    const opened = parseProjectWithMetadata(JSON.stringify(project));
    expect(opened.project.documents[0]!.instances[0]!.reference).toBe("M1");
  });

  it("leaves an imported X reference unchanged", () => {
    const project = legacyProject();
    project.documents[0]!.instances[0]!.reference = "XMSWP0";
    const opened = parseProjectWithMetadata(JSON.stringify(project));
    expect(opened.project.documents[0]!.instances[0]!.reference).toBe("XMSWP0");
  });
});

it.each([
  ["npn", "sky130_fd_pr__npn_05v5_W1p00L1p00", ["C", "B", "E", "S"]],
  ["pnp", "sky130_fd_pr__pnp_05v5_W0p68L0p68", ["C", "B", "E"]],
])(
  "does not turn a %s Q1 into XQ1 on repeated save/open",
  (symbolId, name, pins) => {
    const project = legacyProject();
    const instance = project.documents[0]!.instances[0]!;
    instance.symbolId = symbolId;
    instance.reference = "Q1";
    const definition = project.externalSubcircuitDefinitions[0]!;
    definition.name = name;
    definition.terminals = pins.map((name, index) => ({
      id: `terminal-${index}`,
      name,
      direction: "passive",
    }));
    let opened = project;
    for (let i = 0; i < 3; i++)
      opened = parseProjectWithMetadata(JSON.stringify(opened)).project;
    expect(opened.documents[0]!.instances[0]!.reference).toBe("Q1");
  },
);
