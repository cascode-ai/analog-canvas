import { createEmptyProject, type CircuitProject } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { buildCommittedProjectConnectivityIndex } from "../connectivity-index.js";
import { runErcChecks } from "./erc.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function runErc(project: CircuitProject) {
  return runErcChecks(
    project,
    buildCommittedProjectConnectivityIndex(project, resolver),
    resolver,
  );
}

function mosBiasProject(options: {
  dc?: string;
  waveform?: string;
  mosParams?: Record<string, string>;
  mosCount?: number;
  shunt?: "bjt" | "low-resistor" | "high-resistor" | "vsource";
}): CircuitProject {
  const project = createEmptyProject("bias-check", "Bias Check");
  const doc = project.documents[0]!;
  doc.instances.push(
    {
      id: "VDD",
      symbolId: "vdd-port",
      placement: { position: { x: 100, y: 40 }, rotation: 0, mirror: "none" },
    },
    {
      id: "GND",
      symbolId: "ground",
      placement: { position: { x: 100, y: 260 }, rotation: 0, mirror: "none" },
    },
    {
      id: "I1",
      symbolId: "current-source",
      reference: "I1",
      placement: { position: { x: 100, y: 120 }, rotation: 0, mirror: "none" },
      netlist: {
        binding: { kind: "primitive", deviceClass: "current-source" },
        parameters: {
          ...(options.dc !== undefined ? { dc: options.dc } : {}),
          ...(options.waveform !== undefined
            ? { waveform: options.waveform }
            : {}),
        },
      },
    },
  );

  const biasTerminals = [{ instanceId: "I1", pinName: "-" }];
  const gndTerminals = [{ instanceId: "GND", pinName: "0" }];
  const count = options.mosCount ?? 1;
  for (let i = 0; i < count; i += 1) {
    const id = `M${i + 1}`;
    doc.instances.push({
      id,
      symbolId: "nmos",
      reference: id,
      placement: {
        position: { x: 160 + i * 80, y: 200 },
        rotation: 0,
        mirror: "none",
      },
      netlist: {
        binding: { kind: "primitive", deviceClass: "mos" },
        parameters: options.mosParams ?? { w: "1u", l: "180n" },
      },
    });
    biasTerminals.push(
      { instanceId: id, pinName: "D" },
      { instanceId: id, pinName: "G" },
    );
    gndTerminals.push(
      { instanceId: id, pinName: "S" },
      { instanceId: id, pinName: "B" },
    );
  }

  if (options.shunt === "bjt") {
    doc.instances.push({
      id: "Q1",
      symbolId: "npn",
      reference: "Q1",
      placement: { position: { x: 260, y: 200 }, rotation: 0, mirror: "none" },
    });
    biasTerminals.push(
      { instanceId: "Q1", pinName: "C" },
      { instanceId: "Q1", pinName: "B" },
    );
    gndTerminals.push({ instanceId: "Q1", pinName: "E" });
  } else if (options.shunt === "low-resistor") {
    doc.instances.push({
      id: "R1",
      symbolId: "resistor",
      reference: "R1",
      placement: { position: { x: 260, y: 200 }, rotation: 0, mirror: "none" },
      netlist: {
        binding: { kind: "primitive", deviceClass: "resistor" },
        parameters: { value: "500" },
      },
    });
    biasTerminals.push({ instanceId: "R1", pinName: "1" });
    gndTerminals.push({ instanceId: "R1", pinName: "2" });
  } else if (options.shunt === "high-resistor") {
    doc.instances.push({
      id: "R1",
      symbolId: "resistor",
      reference: "R1",
      placement: { position: { x: 260, y: 200 }, rotation: 0, mirror: "none" },
      netlist: {
        binding: { kind: "primitive", deviceClass: "resistor" },
        parameters: { value: "100k" },
      },
    });
    biasTerminals.push({ instanceId: "R1", pinName: "1" });
    gndTerminals.push({ instanceId: "R1", pinName: "2" });
  } else if (options.shunt === "vsource") {
    doc.instances.push({
      id: "V1",
      symbolId: "voltage-source",
      reference: "V1",
      placement: { position: { x: 260, y: 200 }, rotation: 0, mirror: "none" },
      netlist: {
        binding: { kind: "primitive", deviceClass: "voltage-source" },
        parameters: { dc: "0.7" },
      },
    });
    biasTerminals.push({ instanceId: "V1", pinName: "+" });
    gndTerminals.push({ instanceId: "V1", pinName: "-" });
  }

  doc.nets.push(
    {
      id: "net-vdd",
      terminals: [
        { instanceId: "VDD", pinName: "P" },
        { instanceId: "I1", pinName: "+" },
      ],
    },
    { id: "net-bias", terminals: biasTerminals },
    { id: "net-gnd", terminals: gndTerminals },
  );
  return project;
}

describe("ERC_BIAS_CURRENT_OVERDRIVE (#2614)", () => {
  it("warns non-blockingly when a >= 1 mA DC current source drives narrow IC MOSFETs", () => {
    const diagnostics = runErc(mosBiasProject({ dc: "1m" })).filter(
      (d) => d.code === "ERC_BIAS_CURRENT_OVERDRIVE",
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: "ERC_BIAS_CURRENT_OVERDRIVE",
      severity: "warning",
      confidence: "medium",
      gateEligible: false,
      primary: { kind: "instance", objectId: "I1" },
    });
    expect(diagnostics[0]!.message).toContain("1 mA");
    expect(diagnostics[0]!.message).toContain("1 um");
  });

  it("also catches 1 mA into a narrow 2x1u differential-pair tail or high-impedance shunt", () => {
    expect(
      runErc(mosBiasProject({ dc: "1m", mosCount: 2 })).filter(
        (d) => d.code === "ERC_BIAS_CURRENT_OVERDRIVE",
      ),
    ).toHaveLength(1);
    expect(
      runErc(mosBiasProject({ dc: "1m", shunt: "high-resistor" })).filter(
        (d) => d.code === "ERC_BIAS_CURRENT_OVERDRIVE",
      ),
    ).toHaveLength(1);
  });

  it("stays quiet for microamp IC bias, wide MOSFETs, multiplier-scaled devices, conceptual empty dc, or shunted nodes", () => {
    for (const project of [
      mosBiasProject({ dc: "10u" }),
      mosBiasProject({ dc: "100u" }),
      mosBiasProject({ dc: "1m", mosParams: { w: "20u", l: "180n" } }),
      mosBiasProject({ dc: "1m", mosParams: { w: "1u", m: "10", l: "180n" } }),
      mosBiasProject({ dc: "1m", mosParams: { w: "{W_BIAS}", l: "180n" } }),
      mosBiasProject({ dc: "{IBIAS}" }),
      mosBiasProject({}),
      mosBiasProject({ dc: "1m", waveform: "pulse" }),
      mosBiasProject({ dc: "1m", shunt: "bjt" }),
      mosBiasProject({ dc: "1m", shunt: "low-resistor" }),
      mosBiasProject({ dc: "1m", shunt: "vsource" }),
    ]) {
      expect(
        runErc(project).filter((d) => d.code === "ERC_BIAS_CURRENT_OVERDRIVE"),
      ).toEqual([]);
    }
  });
});
