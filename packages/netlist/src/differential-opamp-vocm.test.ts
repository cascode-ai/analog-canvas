import { describe, expect, it } from "vitest";

import { createEmptyProject, type CircuitProject } from "@icm/model";

import { createDesignNetlistExport } from "./export.js";

/** A fully differential op-amp X1, its VOCM on Net `cm` when `vocm`. */
function fdProject(
  options: {
    vocm?: boolean;
    target?: string;
    parameters?: Record<string, string>;
  } = {},
): CircuitProject {
  const project = createEmptyProject("fd", "FD", "dut");
  const document = project.documents[0]!;
  document.netlist!.name = "dut";
  for (const name of ["VDD", "VSS"]) {
    document.instances.push({ id: name, symbolId: "port", placement: null });
    document.nets.push({
      id: name,
      terminals: [{ instanceId: name, pinName: "P" }],
    });
    document.netlist!.terminals.push({
      id: `terminal-${name}`,
      name,
      netId: name,
      direction: "inout",
      interfaceInstanceIds: [name],
    });
  }
  document.instances.push({
    id: "amp",
    symbolId: "opamp-differential",
    placement: null,
    reference: "X1",
    ...(options.vocm ? { symbolVariantId: "vocm-pin" } : {}),
    netlist: {
      binding: {
        kind: "unresolved-subcircuit",
        name: options.target ?? "opamp_differential",
      },
      parameters: options.parameters ?? {},
    },
  });
  const pins: [string, string][] = [
    ["IN+", "inp"],
    ["IN-", "inn"],
    ["OUT+", "outp"],
    ["OUT-", "outn"],
    ...(options.vocm ? ([["VOCM", "cm"]] as [string, string][]) : []),
  ];
  for (const [pinName, name] of pins) {
    document.nets.push({
      id: name,
      terminals: [{ instanceId: "amp", pinName }],
    });
    document.connectivityEvidence.push({
      id: `${name}-hint`,
      kind: "net-name-hint",
      netId: name,
      sourceName: name,
      origin: "spice-import",
    });
  }
  return project;
}

function exported(project: CircuitProject, format: "spice" | "spectre") {
  const result = createDesignNetlistExport(project, {
    format,
    portCase: "upper",
  });
  expect(result.status).toBe("ready");
  return result.status === "ready" ? result.file.text : "";
}

describe("fully differential op-amp VOCM pin (#2443)", () => {
  it("leaves an unwired VOCM out of the call, as before VOCM was a pin", () => {
    const text = exported(fdProject({ parameters: { vocm: "0.9" } }), "spice");
    expect(text).toContain(
      "X1 VDD VSS inp inn outp outn opamp_differential vocm=0.9",
    );
    expect(text).toContain(
      ".subckt opamp_differential VDD VSS VIP VIN VOP VON params: gain=1e6 vocm=0",
    );
    expect(text).not.toContain("icm_opamp_differential_vocm");
  });

  it("calls the body that reads a wired VOCM, without vocm, in SPICE", () => {
    const text = exported(
      fdProject({ vocm: true, parameters: { gain: "1e4", vocm: "0.9" } }),
      "spice",
    );
    expect(text).toContain(
      "X1 VDD VSS inp inn outp outn cm icm_opamp_differential_vocm gain=1e4",
    );
    expect(text).toContain(
      [
        ".subckt icm_opamp_differential_vocm VDD VSS VIP VIN VOP VON VOCM params: gain=1e6",
        "EPLUS VOP VOCM VIP VIN {gain/2}",
        "EMINUS VON VOCM VIN VIP {gain/2}",
      ].join("\n"),
    );
    expect(text).not.toMatch(/\.subckt opamp_differential\b/u);
  });

  it("calls the body that reads a wired VOCM in Spectre", () => {
    const text = exported(fdProject({ vocm: true }), "spectre");
    expect(text).toContain(
      "X1 (VDD VSS inp inn outp outn cm) icm_opamp_differential_vocm",
    );
    expect(text).toContain(
      "subckt icm_opamp_differential_vocm (VDD VSS VIP VIN VOP VON VOCM)",
    );
    expect(text).toContain("EPLUS (VOP VOCM VIP VIN) vcvs gain=gain/2");
  });

  it("passes a wired VOCM to a part retargeted to the reader's master", () => {
    const text = exported(
      fdProject({ vocm: true, target: "my_fd", parameters: { vocm: "1" } }),
      "spice",
    );
    expect(text).toContain("X1 VDD VSS inp inn outp outn cm my_fd vocm=1");
    expect(text).not.toContain("icm_opamp_differential_vocm");
  });

  it("models optional gbw and rout on differential op-amps with or without VOCM (#2615)", () => {
    const spiceBoth = exported(
      fdProject({
        vocm: true,
        parameters: { gain: "1e4", gbw: "20Meg", rout: "75" },
      }),
      "spice",
    );
    expect(spiceBoth).toContain(
      "X1 VDD VSS inp inn outp outn cm icm_opamp_differential_vocm_gbw_rout gain=1e4 gbw=20Meg rout=75",
    );
    expect(spiceBoth).toContain(
      ".subckt icm_opamp_differential_vocm_gbw_rout VDD VSS VIP VIN VOP VON VOCM params: gain=1e6 gbw=1e7\n+ rout=100",
    );
    expect(spiceBoth).toContain("EDIFF ndiff_raw 0 VIP VIN {gain}");
    expect(spiceBoth).toContain("RPOLE ndiff_raw ndiff 1");
    expect(spiceBoth).toContain("CPOLE ndiff 0 {gain/(6.283185307179586*gbw)}");
    expect(spiceBoth).toContain("ROUTP noutp VOP {rout}");
    expect(spiceBoth).toContain("ROUTN noutn VON {rout}");

    const spectreGbw = exported(
      fdProject({ parameters: { vocm: "0.9", gbw: "5Meg" } }),
      "spectre",
    );
    expect(spectreGbw).toContain(
      "X1 (VDD VSS inp inn outp outn) icm_opamp_differential_gbw gbw=5M vocm=0.9",
    );
    expect(spectreGbw).toContain(
      "subckt icm_opamp_differential_gbw (VDD VSS VIP VIN VOP VON)",
    );
    expect(spectreGbw).toContain("RPOLE (ndiff_raw ndiff) resistor r=1");
    expect(spectreGbw).toContain(
      "CPOLE (ndiff 0) capacitor c=gain/(6.283185307179586*gbw)",
    );

    const invalid = createDesignNetlistExport(
      fdProject({ parameters: { gbw: "-1Meg" } }),
      { format: "spice", portCase: "upper" },
    );
    expect(invalid.status).toBe("blocked");
    expect(invalid.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "INVALID_IDEAL_OPAMP_PARAMETER",
        parameter: "gbw",
      }),
    );
  });
});
