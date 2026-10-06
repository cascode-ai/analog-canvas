import { describe, expect, it } from "vitest";

import { createEmptyProject } from "@icm/model";
import { IDEAL_COMPARATOR_TARGET } from "@icm/devices";

import { createDesignNetlistExport } from "./export.js";
import { analyzeDesignNetlist } from "./extract.js";
import { printVacaskWithLocations } from "./vacask-printer.js";

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
    // A numeric high level, as every comparator placed before VDD was the
    // default stores.
    const spectre = createDesignNetlistExport(
      comparatorProject({ vhigh: "1", vtransition: "10m" }),
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
      `X1 (plus minus output) ${IDEAL_COMPARATOR_TARGET} vhigh=1 vtransition=10m`,
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

  it("prints the numeric body in native VACASK, naming its parameters", () => {
    // A call's parameter takes the master's spelling: VHIGH prints vhigh.
    const { ir } = analyzeDesignNetlist(
      comparatorProject({ VHIGH: "2", vtransition: "10m" }),
      { groundPin: "pin" },
    );
    const vacask = printVacaskWithLocations(ir!);
    expect(vacask.ok).toBe(true);
    if (!vacask.ok) return;
    for (const line of [
      `subckt ${IDEAL_COMPARATOR_TARGET} (VIP VIN VOUT)`,
      "parameters vhigh=1",
      "parameters vlow=0",
      "parameters vtransition=0.001",
      "bcmp (VOUT 0) v=(vlow+(vhigh-vlow)*0.5*(1+tanh((v(VIP)-v(VIN))/vtransition)))",
      `X1 (plus minus output) ${IDEAL_COMPARATOR_TARGET} vhigh=2 vtransition=0.01`,
    ])
      expect(vacask.text.split("\n"), vacask.text).toContain(line);
  });

  it("rejects a user Cell named after either generated comparator body", () => {
    for (const [name, vhigh] of [
      [IDEAL_COMPARATOR_TARGET, "1"],
      [IDEAL_COMPARATOR_TARGET, "VDD"],
      ["icm_ideal_comparator_vdd", "1"],
      ["icm_ideal_comparator_vdd", "VDD"],
    ]) {
      const project = comparatorProject({ vhigh: vhigh! });
      project.documents[0]!.netlist!.name = name!;
      const result = createDesignNetlistExport(project);
      expect(result.status, `${name} ${vhigh}`).toBe("blocked");
      expect(
        result.diagnostics.find(
          (item) => item.code === "IDEAL_COMPARATOR_NAME_COLLISION",
        )?.message,
      ).toBe(`Ideal comparator X1 conflicts with Cell ${name} named ${name}`);
    }
  });
});

describe("an ideal comparator whose high level is VDD (#1306)", () => {
  // What a comparator placed today stores. The logic it drives reads a high
  // above half its supply, which a fixed 1 V never reached at VDD >= 2 V.
  const placed = { vhigh: "VDD", vlow: "0", vtransition: "1m" };

  it("swings from vlow up to its own VDD, the Cell's default supply here", () => {
    const result = createDesignNetlistExport(comparatorProject(placed));
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    // No supply is drawn, so VDD becomes the Cell's pin, as a logic block's
    // does (#1292); the comparator reads no VSS.
    expect(result.file.text).toBe(
      [
        "",
        ".subckt icm_ideal_comparator_vdd VDD VIP VIN VOUT params: vlow=0 vtransition=1m",
        "Bcmp VOUT 0 V={vlow+(V(VDD)-vlow)*0.5*(1+tanh((V(VIP)-V(VIN))/vtransition))}",
        ".ends icm_ideal_comparator_vdd",
        "",
        ".subckt dut VDD",
        "X1 VDD plus minus output icm_ideal_comparator_vdd vlow=0 vtransition=1m",
        ".ends dut",
        "",
      ].join("\n"),
    );
  });

  it("prints the same equation in Spectre and native VACASK", () => {
    const project = comparatorProject(placed);
    const spectre = createDesignNetlistExport(project, { format: "spectre" });
    expect(spectre.status).toBe("ready");
    if (spectre.status !== "ready") return;
    for (const line of [
      "subckt icm_ideal_comparator_vdd (VDD VIP VIN VOUT)",
      "parameters vlow=0 vtransition=1m",
      "Bcmp (VOUT 0) bsource v=vlow+(v(VDD)-vlow)*0.5*(1+tanh((v(VIP)-v(VIN))/vtransition))",
      "X1 (VDD plus minus output) icm_ideal_comparator_vdd vlow=0 vtransition=1m",
    ])
      expect(spectre.file.text.split("\n")).toContain(line);
    expect(spectre.file.text).not.toContain(`${IDEAL_COMPARATOR_TARGET} (`);

    const { ir } = analyzeDesignNetlist(project, { groundPin: "pin" });
    const vacask = printVacaskWithLocations(ir!);
    expect(vacask.ok).toBe(true);
    if (!vacask.ok) return;
    for (const line of [
      "subckt icm_ideal_comparator_vdd (VDD VIP VIN VOUT)",
      "parameters vlow=0",
      "parameters vtransition=0.001",
      "bcmp (VOUT 0) v=(vlow+(v(VDD)-vlow)*0.5*(1+tanh((v(VIP)-v(VIN))/vtransition)))",
      "X1 (VDD plus minus output) icm_ideal_comparator_vdd vlow=0 vtransition=0.001",
    ])
      expect(vacask.text.split("\n"), vacask.text).toContain(line);
    expect(vacask.text).not.toMatch(/vhigh/u);
  });

  it("reads VDD in any case, and takes it as the default when vhigh is absent", () => {
    for (const parameters of [
      { vhigh: "vdd" },
      { VHIGH: " Vdd " },
      { vlow: "0.2" },
    ]) {
      const result = createDesignNetlistExport(comparatorProject(parameters));
      expect(result.status, JSON.stringify(parameters)).toBe("ready");
      if (result.status !== "ready") continue;
      expect(result.file.text).toMatch(
        /^X1 VDD plus minus output icm_ideal_comparator_vdd(?: vlow=0\.2)?$/mu,
      );
      expect(result.file.text).not.toMatch(/vhigh=/iu);
    }
  });

  it("refuses a high level that is neither a number nor VDD", () => {
    for (const [name, value, message] of [
      [
        "vhigh",
        "VSS",
        "Ideal comparator X1 requires vhigh to be a number or VDD",
      ],
      [
        "vhigh",
        "{vdd}",
        "Ideal comparator X1 requires vhigh to be a number or VDD",
      ],
      ["vlow", "VDD", "Ideal comparator X1 requires numeric vlow"],
    ] as const) {
      const result = createDesignNetlistExport(
        comparatorProject({ [name]: value }),
      );
      expect(result.status, value).toBe("blocked");
      expect(
        result.diagnostics.find(
          (item) => item.code === "INVALID_IDEAL_COMPARATOR_PARAMETER",
        )?.message,
      ).toBe(message);
    }
  });
});
