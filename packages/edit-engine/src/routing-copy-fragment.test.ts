import { createEmptyDocument, createRoutePath } from "@icm/model";
import { describe, expect, it } from "vitest";

import { captureRoutingCopyFragment } from "./routing-copy-fragment.js";

describe("routing copy fragment", () => {
  it("disconnects ordinary boundary terminals but retains selected named owners", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push(
      { id: "R1", symbolId: "resistor", placement: null },
      { id: "R2", symbolId: "resistor", placement: null },
      { id: "V1", symbolId: "vdd-port", placement: null },
    );
    document.nets.push(
      {
        id: "signal",
        terminals: [
          { instanceId: "R1", pinName: "1" },
          { instanceId: "R2", pinName: "1" },
        ],
      },
      {
        id: "vdd",
        terminals: [
          { instanceId: "V1", pinName: "P" },
          { instanceId: "R2", pinName: "2" },
        ],
      },
    );
    document.connectivityEvidence.push({
      id: "claim",
      kind: "name-claim",
      netId: "vdd",
      name: "VDD",
      scope: "global",
      owner: { kind: "power-marker", objectId: "V1" },
      powerDomain: "vdd",
    });

    const capture = captureRoutingCopyFragment(document, {
      instanceIds: ["R1", "V1"],
      routeIds: [],
      junctionIds: [],
    });
    expect(capture.clonedNetIds).toEqual(["vdd"]);
    expect(capture.boundaryTerminalKeys).toEqual(["terminal:R1:1"]);
  });

  it("does not infer a dangling Route or ordinary Net for an explicit copy", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push({ id: "M1", symbolId: "nmos", placement: null });
    document.nets.push({
      id: "signal",
      terminals: [{ instanceId: "M1", pinName: "G" }],
    });
    document.junctions.push({
      id: "J1",
      netId: "signal",
      position: { x: 0, y: 0 },
    });
    document.routes.push(
      createRoutePath({
        id: "dangling",
        netId: "signal",
        start: { kind: "terminal", instanceId: "M1", pinName: "G" },
        end: { kind: "junction", junctionId: "J1" },
        bends: [],
        modes: ["manual"],
      }),
    );

    const capture = captureRoutingCopyFragment(
      document,
      { instanceIds: ["M1"], routeIds: [], junctionIds: [] },
      { includeImplicitInstanceRoutes: false },
    );
    expect(capture.affected.internalRoutes).toEqual([]);
    expect(capture.affected.internalJunctions).toEqual([]);
    expect(capture.clonedNetIds).toEqual([]);
    expect(capture.boundaryTerminalKeys).toEqual(["terminal:M1:G"]);
  });
});
