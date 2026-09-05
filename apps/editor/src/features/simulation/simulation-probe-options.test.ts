import { describe, expect, it } from "vitest";
import { CircuitProjectSchema } from "@icm/model";

import fiveTransistorOtaSky130 from "../../examples/five-transistor-ota-sky130.icproj.json";
import {
  deriveSimulationProbeOptions,
  matchSimulationVoltageProbeOptions,
  resolveSimulationVoltageProbeNetId,
  simulationProbeHierarchyPath,
  simulationProbeTargetKey,
  simulationVoltageProbeTargetsNet,
} from "./simulation-probe-options";

describe("simulation probe choices", () => {
  it("keeps hierarchy occurrences and voltage-source currents addressable", () => {
    const project = CircuitProjectSchema.parse(fiveTransistorOtaSky130);
    const options = deriveSimulationProbeOptions(
      project,
      "document-ota-5t-testbench",
    );

    expect(
      options.voltage.find(
        (option) =>
          option.target.anchor.kind === "terminal" &&
          option.target.anchor.instanceId === "M5" &&
          option.target.anchor.pinName === "D",
      ),
    ).toMatchObject({
      label: "XDUT · ota_5t · tail",
      target: {
        kind: "net-voltage",
        documentId: "document-ota-5t",
        anchor: { kind: "terminal", instanceId: "M5", pinName: "D" },
        occurrence: ["XDUT"],
      },
    });
    expect(options.sourceCurrent.map((option) => option.label)).toEqual([
      "Testbench · VDD current",
      "Testbench · VINP current",
      "Testbench · VINN current",
    ]);
  });

  it("gives repeated calls of the same Cell different target identities", () => {
    const project = CircuitProjectSchema.parse(fiveTransistorOtaSky130);
    const testbench = project.documents.find(
      (document) => document.id === "document-ota-5t-testbench",
    )!;
    const first = testbench.instances.find(
      (instance) => instance.id === "XDUT",
    )!;
    testbench.instances.push({
      ...structuredClone(first),
      id: "XDUT2",
      reference: "XDUT2",
    });

    const targets = deriveSimulationProbeOptions(
      project,
      testbench.id,
    ).voltage.filter(
      (option) =>
        option.target.anchor.kind === "terminal" &&
        option.target.anchor.instanceId === "M5" &&
        option.target.anchor.pinName === "D",
    );
    expect(targets.map((option) => option.target.occurrence)).toEqual([
      ["XDUT"],
      ["XDUT2"],
    ]);
    expect(new Set(targets.map((option) => option.key)).size).toBe(2);
    expect(
      targets.map((option) => simulationProbeTargetKey(option.target)),
    ).toEqual(targets.map((option) => option.key));

    expect(
      matchSimulationVoltageProbeOptions(project, targets, {
        documentId: "document-ota-5t",
        netId: "net-dut-tail",
      }),
    ).toHaveLength(2);
    expect(
      matchSimulationVoltageProbeOptions(project, targets, {
        documentId: "document-ota-5t",
        netId: "net-dut-tail",
        occurrence: ["XDUT2"],
      }).map((option) => option.target.occurrence),
    ).toEqual([["XDUT2"]]);
  });

  it("resolves an object anchor for canvas focus and matches its whole Logical Net", () => {
    const project = CircuitProjectSchema.parse(fiveTransistorOtaSky130);
    const target = deriveSimulationProbeOptions(
      project,
      "document-ota-5t-testbench",
    ).voltage.find(
      (option) =>
        option.target.anchor.kind === "terminal" &&
        option.target.anchor.instanceId === "M5" &&
        option.target.anchor.pinName === "D",
    )!.target;

    expect(resolveSimulationVoltageProbeNetId(project, target)).toBe(
      "net-dut-tail",
    );
    expect(
      simulationVoltageProbeTargetsNet(project, target, "net-dut-tail"),
    ).toBe(true);
    expect(
      simulationVoltageProbeTargetsNet(project, target, "net-dut-vout"),
    ).toBe(false);
  });

  it("resolves a probe occurrence to the canvas hierarchy path", () => {
    const project = CircuitProjectSchema.parse(fiveTransistorOtaSky130);

    expect(
      simulationProbeHierarchyPath(project, "document-ota-5t-testbench", [
        "XDUT",
      ]),
    ).toEqual([
      {
        parentDocumentId: "document-ota-5t-testbench",
        instanceId: "XDUT",
        childDocumentId: "document-ota-5t",
      },
    ]);
    expect(
      simulationProbeHierarchyPath(project, "document-ota-5t-testbench", [
        "missing-instance",
      ]),
    ).toBeNull();
  });
});
