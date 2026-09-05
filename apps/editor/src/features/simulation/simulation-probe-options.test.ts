import { describe, expect, it } from "vitest";
import { CircuitProjectSchema } from "@icm/model";

import fiveTransistorOtaSky130 from "../../examples/five-transistor-ota-sky130.icproj.json";
import {
  deriveSimulationProbeOptions,
  simulationProbeTargetKey,
} from "./simulation-probe-options";

describe("simulation probe choices", () => {
  it("keeps hierarchy occurrences and voltage-source currents addressable", () => {
    const project = CircuitProjectSchema.parse(fiveTransistorOtaSky130);
    const options = deriveSimulationProbeOptions(
      project,
      "document-ota-5t-testbench",
    );

    expect(
      options.voltage.find((option) => option.target.netId === "net-dut-tail"),
    ).toMatchObject({
      label: "XDUT · ota_5t · tail",
      target: {
        kind: "net-voltage",
        documentId: "document-ota-5t",
        netId: "net-dut-tail",
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
    ).voltage.filter((option) => option.target.netId === "net-dut-tail");
    expect(targets.map((option) => option.target.occurrence)).toEqual([
      ["XDUT"],
      ["XDUT2"],
    ]);
    expect(new Set(targets.map((option) => option.key)).size).toBe(2);
    expect(
      targets.map((option) => simulationProbeTargetKey(option.target)),
    ).toEqual(targets.map((option) => option.key));
  });
});
