import { describe, expect, it } from "vitest";
import { createEmptyProject } from "@icm/model";
import { createDesignNetlistExport } from "./export.js";
import { analyzeDesignNetlist } from "./extract.js";

function comparatorProject(parameters: Record<string, string> = {}) {
  const project = createEmptyProject("fd-comparator", "FD Comparator", "dut");
  const document = project.documents[0]!;
  document.netlist!.name = "dut";
  document.instances.push({
    id: "cmp",
    symbolId: "comparator-differential",
    reference: "X1",
    placement: null,
    netlist: { parameters },
  });
  for (const [pinName, name] of [
    ["IN+", "plus"],
    ["IN-", "minus"],
    ["OUT+", "positive"],
    ["OUT-", "negative"],
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

describe("fully differential ideal comparator", () => {
  it("exports complementary outputs using only the selected high supply", () => {
    const project = comparatorProject();
    const before = structuredClone(project);
    const result = createDesignNetlistExport(project);
    expect(result.status, JSON.stringify(result.diagnostics)).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.file.text).toContain(
      ".subckt icm_ideal_comparator_differential_vdd VDD VIP VIN VOP VON params: vlow=0 vtransition=1m",
    );
    expect(result.file.text).toContain(
      "X1 VDD plus minus positive negative icm_ideal_comparator_differential_vdd",
    );
    expect(result.file.text).toContain(
      "Bcmp VOP 0 V={vlow+(V(VDD)-vlow)*0.5*(1+tanh((V(VIP)-V(VIN))/vtransition))}",
    );
    expect(result.file.text).toContain(
      "Bcmpn VON 0 V={vlow+(V(VDD)-vlow)*0.5*(1-tanh((V(VIP)-V(VIN))/vtransition))}",
    );
    expect(result.externalMasterCount).toBe(0);
    expect(project).toEqual(before);
  });

  it.each(["spice", "spectre"] as const)(
    "exports numeric levels and two output equations in %s without unused supplies",
    (format) => {
      const project = comparatorProject({
        vhigh: "2",
        vlow: "-1",
        vtransition: "10m",
      });
      const analysis = analyzeDesignNetlist(project, { format });
      expect(analysis.ir, JSON.stringify(analysis.diagnostics)).not.toBeNull();
      if (!analysis.ir) return;
      const result = createDesignNetlistExport(project, { format });
      const text = result.status === "ready" ? result.file.text : "";
      expect(text).toContain("icm_ideal_comparator_differential");
      expect(text).toMatch(/(?:Bcmp|bcmp)\b.*VOP/u);
      expect(text).toMatch(/(?:Bcmpn|bcmpn)\b.*VON/u);
      expect(text).not.toMatch(/VDD|VSS/u);
      expect(text).toContain("vhigh=2");
      expect(text).toContain("vlow=-1");
    },
  );

  it("uses its VDD body and consumes the keyword before spectre printing", () => {
    const project = comparatorProject({ vhigh: "VDD" });
    const analysis = analyzeDesignNetlist(project);
    if (!analysis.ir) throw Error(JSON.stringify(analysis.diagnostics));
    const result = createDesignNetlistExport(project, { format: "spectre" });
    const text = result.status === "ready" ? result.file.text : "";
    expect(text).toContain("icm_ideal_comparator_differential_vdd");
    expect(text).toMatch(/1-tanh/u);
    expect(text).not.toMatch(/vhigh=VDD/u);
  });

  it("rejects invalid parameters with the same comparator diagnostics", () => {
    const result = createDesignNetlistExport(
      comparatorProject({ vtransition: "0" }),
    );
    expect(result.status).toBe("blocked");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "INVALID_IDEAL_COMPARATOR_PARAMETER" }),
    );
  });
});
