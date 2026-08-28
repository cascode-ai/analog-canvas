import { createEmptyDocument } from "@icm/model";
import { describe, expect, it } from "vitest";

import { digitalSimulationInputFingerprint } from "./fingerprint.js";

describe("digital simulation input fingerprint", () => {
  it("ignores presentation-only changes", () => {
    const document = createEmptyDocument("doc", "Clock");
    document.instances.push({
      id: "CLK",
      symbolId: "pulse-voltage-source",
      placement: {
        position: { x: 0, y: 0 },
        rotation: 0,
        mirror: "none",
      },
      netlist: {
        reference: "V1",
        parameters: {
          period: "10ns",
          dutyCycle: "50",
          initial: "0",
          rise: "1ps",
          fall: "1ps",
        },
      },
    });
    document.nets.push({
      id: "clock",
      terminals: [{ instanceId: "CLK", pinName: "+" }],
    });
    const baseline = digitalSimulationInputFingerprint(document);

    document.revision += 1;
    document.instances[0]!.placement!.position = { x: 100, y: 80 };
    document.instances[0]!.netlist!.parameters.rise = "10ps";
    document.drafting = { objects: [] };

    expect(digitalSimulationInputFingerprint(document)).toBe(baseline);
  });

  it("changes for connectivity and every simulator-relevant parameter", () => {
    const document = createEmptyDocument("doc", "Clock");
    document.instances.push({
      id: "CLK",
      symbolId: "pulse-voltage-source",
      placement: null,
      netlist: {
        reference: "V1",
        parameters: { period: "10ns", dutyCycle: "50", initial: "0" },
      },
    });
    document.nets.push({
      id: "clock",
      terminals: [{ instanceId: "CLK", pinName: "+" }],
    });
    const baseline = digitalSimulationInputFingerprint(document);

    for (const [name, value] of [
      ["period", "20ns"],
      ["dutyCycle", "25"],
      ["initial", "1"],
    ] as const) {
      const changed = structuredClone(document);
      changed.instances[0]!.netlist!.parameters[name] = value;
      expect(digitalSimulationInputFingerprint(changed)).not.toBe(baseline);
    }

    const disconnected = structuredClone(document);
    disconnected.nets[0]!.terminals = [];
    expect(digitalSimulationInputFingerprint(disconnected)).not.toBe(baseline);
  });
});
