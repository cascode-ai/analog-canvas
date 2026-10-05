import { describe, expect, it } from "vitest";

import { createEmptyProject } from "@icm/model";
import { IDEAL_COMPARATOR_TARGET } from "@icm/devices";

import { createDesignNetlistExport } from "./export.js";

function comparatorProject(parameters: Record<string, string> = {}) {
  const project = createEmptyProject("comparator", "Comparator", "dut");
  const document = project.documents[0]!;
  document.netlist!.name = "dut";
  document.instances.push({
    id: "cmp",
    symbolId: "comparator",
    reference: "X1",
    placement: null,
    netlist: {
      binding: { kind: "unresolved-subcircuit", name: IDEAL_COMPARATOR_TARGET },
      parameters,
    },
  });
  for (const [pinName, name] of [
    ["IN+", "plus"],
    ["IN-", "minus"],
    ["OUT", "output"],
  ] as const) {
    document.nets.push({
      id: name,
      terminals: [{ instanceId: "cmp", pinName }],
    });
    document.connectivityEvidence.push({
      id: `${name}-name`,
      kind: "net-name-hint",
      netId: name,
      sourceName: name,
      origin: "spice-import",
    });
  }
  return project;
}

describe("ideal comparator", () => {
  it("emits one signal-only ngspice body without inventing VDD/VSS", () => {
    const project = comparatorProject({
      vhigh: "2",
      vlow: "-1",
      vtransition: "10m",
    });
    const before = structuredClone(project);
    const result = createDesignNetlistExport(project, { format: "spice" });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.file.text).toContain(
      `.subckt ${IDEAL_COMPARATOR_TARGET} VIP VIN VOUT params: vhigh=1 vlow=0 vtransition=1m`,
    );
    expect(result.file.text).toContain(
      `X1 plus minus output ${IDEAL_COMPARATOR_TARGET} vhigh=2 vlow=-1 vtransition=10m`,
    );
    expect(result.file.text).not.toContain(".global VDD VSS");
    expect(result.externalMasterCount).toBe(0);
    expect(project).toEqual(before);
  });

  it("blocks invalid transition values without silently retargeting", () => {
    const invalid = createDesignNetlistExport(
      comparatorProject({ vtransition: "0" }),
    );
    expect(invalid.status).toBe("blocked");
    expect(invalid.diagnostics.map((item) => item.code)).toContain(
      "INVALID_IDEAL_COMPARATOR_PARAMETER",
    );
  });

  it("includes the same signal-only comparator in Spectre and maps its call", () => {
    const spectre = createDesignNetlistExport(
      comparatorProject({ vtransition: "10m" }),
      {
        format: "spectre",
        includeLocations: true,
      },
    );
    expect(spectre.status).toBe("ready");
    if (spectre.status !== "ready") return;
    expect(spectre.file.text).toContain(
      `subckt ${IDEAL_COMPARATOR_TARGET} (VIP VIN VOUT)`,
    );
    expect(spectre.file.text).toContain(
      "Bcmp (VOUT 0) bsource v=vlow+(vhigh-vlow)*0.5*(1+tanh((v(VIP)-v(VIN))/vtransition))",
    );
    expect(spectre.file.text).toContain(
      `X1 (plus minus output) ${IDEAL_COMPARATOR_TARGET} vtransition=10m`,
    );
    expect(spectre.externalMasterCount).toBe(0);
    const location = spectre.locations.instances.find(
      (i) => i.instanceId === "cmp",
    )!;
    expect(
      spectre.file.text.slice(location.startOffset, location.endOffset),
    ).toMatch(/^X1 \(plus minus output\)/u);
    expect(spectre.file.text).not.toContain("global VDD");
  });

  it("rejects a user Cell that would shadow the generated comparator body", () => {
    const project = comparatorProject();
    project.documents[0]!.netlist!.name = IDEAL_COMPARATOR_TARGET;
    const result = createDesignNetlistExport(project);
    expect(result.status).toBe("blocked");
    expect(result.diagnostics.map((item) => item.code)).toContain(
      "IDEAL_COMPARATOR_NAME_COLLISION",
    );
  });
});
