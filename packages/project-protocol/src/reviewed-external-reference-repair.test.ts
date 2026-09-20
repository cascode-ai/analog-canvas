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

describe("legacy reviewed external reference repair", () => {
  it("canonicalizes the old authored device prefix to the ngspice X call", () => {
    const opened = parseProjectWithMetadata(JSON.stringify(legacyProject()));
    expect(opened.migrated).toBe(true);
    expect(opened.project.documents[0]!.instances[0]!.reference).toBe("XM1");
  });

  it("keeps a bound display format valid when the reference is repaired", () => {
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
    expect(opened.project.documents[0]!.instances[0]!.reference).toBe("XM1");
    expect(flattenRichText(label.formatOverride!)).toBe("XM1");
  });

  it("does not rewrite when the repaired reference would collide", () => {
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
