import { createEmptyDocument } from "@icm/model";
import { describe, expect, it } from "vitest";

import { capacitorPlatePropertyRows } from "./capacitor-plate-properties";

describe("capacitor plate Properties projection", () => {
  it("reports fixed-capacitor Pin order and current named/unnamed Nets", () => {
    const document = createEmptyDocument("main", "Main");
    const instance = {
      id: "C1",
      symbolId: "capacitor",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 90 as const,
        mirror: "none" as const,
      },
    };
    document.instances.push(instance);
    document.nets.push(
      {
        id: "net-out",
        name: "OUT",
        scope: "local",
        terminals: [{ instanceId: "C1", pinName: "1" }],
      },
      {
        id: "net-return",
        scope: "local",
        terminals: [{ instanceId: "C1", pinName: "2" }],
      },
    );
    document.connectivityEvidence.push({
      id: "claim-out",
      kind: "name-claim",
      netId: "net-out",
      name: "OUT",
      owner: { kind: "explicit-net-property" },
      scope: "local",
    });

    expect(capacitorPlatePropertyRows(document, instance)).toEqual([
      {
        role: "capacitor-top-plate",
        label: "Top plate",
        pinName: "1",
        sourceNodePosition: 1,
        netId: "net-out",
        netName: "OUT",
      },
      {
        role: "capacitor-bottom-plate",
        label: "Bottom plate",
        pinName: "2",
        sourceNodePosition: 2,
        netId: "net-return",
        netName: null,
      },
    ]);
  });

  it("uses P1/P2 for variable capacitors and exposes unconnected plates", () => {
    const document = createEmptyDocument("main", "Main");
    const instance = {
      id: "CVAR1",
      symbolId: "variable-capacitor",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    };
    document.instances.push(instance);

    expect(capacitorPlatePropertyRows(document, instance)).toEqual([
      expect.objectContaining({
        label: "Top plate",
        pinName: "P1",
        sourceNodePosition: 1,
        netId: null,
      }),
      expect.objectContaining({
        label: "Bottom plate",
        pinName: "P2",
        sourceNodePosition: 2,
        netId: null,
      }),
    ]);
  });

  it("does not project plate rows for another device class", () => {
    const document = createEmptyDocument("main", "Main");
    const resistor = {
      id: "R1",
      symbolId: "resistor",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    };
    expect(capacitorPlatePropertyRows(document, resistor)).toBeNull();
  });
});
