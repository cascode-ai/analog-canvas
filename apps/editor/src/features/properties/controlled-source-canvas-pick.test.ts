import { createEmptyDocument } from "@icm/model";
import { describe, expect, it } from "vitest";
import {
  advanceControlPick,
  type ControlPickState,
} from "./controlled-source-canvas-pick";

const document = createEmptyDocument("cell", "Cell");
document.instances.push(
  { id: "G1", symbolId: "vccs", placement: null, reference: "G1" },
  { id: "V1", symbolId: "voltage-source", placement: null, reference: "V1" },
  { id: "R1", symbolId: "resistor", placement: null, reference: "R1" },
);
document.nets.push(
  { id: "ground-a", terminals: [] },
  { id: "ground-b", terminals: [] },
  { id: "signal", terminals: [] },
);
document.connectivityEvidence.push(
  {
    id: "ground-claim-a",
    kind: "name-claim",
    netId: "ground-a",
    owner: { kind: "power-marker", objectId: "P1" },
    name: "0",
    scope: "global",
    powerDomain: "ground",
  },
  {
    id: "ground-claim-b",
    kind: "name-claim",
    netId: "ground-b",
    owner: { kind: "power-marker", objectId: "P2" },
    name: "0",
    scope: "global",
    powerDomain: "ground",
  },
);
const isVoltageSource = (symbolId: string) => symbolId === "voltage-source";

describe("controlled-source canvas pick", () => {
  it("canonicalizes repeated ground markers and commits a voltage pair only after two picks", () => {
    const start: ControlPickState = {
      documentId: document.id,
      instanceId: "G1",
      kind: "voltage",
    };
    const first = advanceControlPick(
      start,
      document,
      { kind: "net", netId: "ground-b" },
      isVoltageSource,
    );
    expect(first).toMatchObject({
      kind: "continue",
      state: { positiveNetId: "ground-a" },
    });
    if (first.kind !== "continue") throw new Error("Expected first pick");
    expect(
      advanceControlPick(
        first.state,
        document,
        { kind: "net", netId: "ground-a" },
        isVoltageSource,
      ),
    ).toMatchObject({
      kind: "reject",
      message: "Control − must be a different Net",
    });
    expect(
      advanceControlPick(
        first.state,
        document,
        { kind: "net", netId: "signal" },
        isVoltageSource,
      ),
    ).toMatchObject({
      kind: "complete",
      control: {
        kind: "voltage",
        positiveNetId: "ground-a",
        negativeNetId: "signal",
      },
    });
  });

  it("accepts only a voltage-source branch as a current sensor", () => {
    const start: ControlPickState = {
      documentId: document.id,
      instanceId: "G1",
      kind: "current",
    };
    expect(
      advanceControlPick(
        start,
        document,
        { kind: "sensor", instanceId: "R1" },
        isVoltageSource,
      ).kind,
    ).toBe("reject");
    expect(
      advanceControlPick(
        start,
        document,
        { kind: "sensor", instanceId: "V1" },
        isVoltageSource,
      ),
    ).toMatchObject({
      kind: "complete",
      control: { kind: "current", sensorInstanceId: "V1" },
    });
  });

  it("rejects picks after leaving the owning Cell", () => {
    const start: ControlPickState = {
      documentId: "other",
      instanceId: "G1",
      kind: "voltage",
    };
    expect(
      advanceControlPick(
        start,
        document,
        { kind: "net", netId: "signal" },
        isVoltageSource,
      ).kind,
    ).toBe("reject");
  });
});
