import { createEmptyDocument, supplyLabelFormat } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { resolveDocumentLogicalNets } from "@icm/derived";
import { gateRoutingOperationPlan } from "./routing-operation-plan.js";
import {
  planElectricalMarkerRename,
  planLogicalNetRename,
} from "./net-name-operation-planner.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function addSupply(
  document: ReturnType<typeof createEmptyDocument>,
  id: string,
  netId: string,
  name = "VDD",
): void {
  document.instances.push({ id, symbolId: "vdd-port", placement: null });
  document.nets.push({
    id: netId,
    terminals: [{ instanceId: id, pinName: "P" }],
  });
  document.connectivityEvidence.push({
    id: `claim-${id}`,
    kind: "name-claim",
    netId,
    name,
    scope: "global",
    powerDomain: "vdd",
    owner: { kind: "power-marker", objectId: id },
  });
}

/** The label a placed global VDD Port shows, in its stored default look. */
function addSupplyLabel(
  document: ReturnType<typeof createEmptyDocument>,
  id: string,
  netId: string,
  name = "VDD",
): void {
  document.annotations.push({
    id: `power-label-${id.toLowerCase()}`,
    kind: "power-label",
    binding: { kind: "net-name", netId },
    formatOverride: supplyLabelFormat(name)!,
    netId,
    anchor: {
      kind: "object",
      objectId: id,
      localOffset: { x: 20, y: 0 },
      fallbackPosition: { x: 20, y: 0 },
    },
    alignment: "start",
    rotation: 0,
    locked: false,
  });
}

describe("Net name operation planner", () => {
  it("renames one supply owner without renaming its peers", () => {
    const document = createEmptyDocument("main", "Main");
    addSupply(document, "V1", "net-v1");
    addSupply(document, "V2", "net-v2");

    const planned = planElectricalMarkerRename(document, "V1", "AVDD");
    expect(planned.status).toBe("ready");
    if (planned.status !== "ready") return;
    const result = gateRoutingOperationPlan(document, planned.plan, {
      symbolResolver: resolver,
    });
    if (!result.ok) throw new Error(result.message);
    const logical = resolveDocumentLogicalNets(result.evaluated.finalDocument);
    const nameOf = (instanceId: string) => {
      const net = result.evaluated.finalDocument.nets.find((candidate) =>
        candidate.terminals.some(
          (terminal) => terminal.instanceId === instanceId,
        ),
      )!;
      return logical.byBaseNetId.get(net.id)?.name;
    };
    expect(nameOf("V1")).toBe("AVDD");
    expect(nameOf("V2")).toBe("VDD");
  });

  it("renames a whole Logical Net and merges only compatible name semantics", () => {
    const document = createEmptyDocument("main", "Main");
    addSupply(document, "VA", "net-a", "AVDD");
    addSupply(document, "VB", "net-b", "DVDD");
    const source =
      resolveDocumentLogicalNets(document).byBaseNetId.get("net-a")!;
    const planned = planLogicalNetRename(document, source.id, "DVDD", "global");
    expect(planned.status).toBe("ready");
    if (planned.status !== "ready") return;
    const result = gateRoutingOperationPlan(document, planned.plan);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const logical = resolveDocumentLogicalNets(result.evaluated.finalDocument);
    expect(logical.groups).toHaveLength(1);
    expect(logical.groups[0]).toMatchObject({
      name: "DVDD",
      scope: "global",
      powerDomain: "vdd",
    });
    expect(result.evaluated.finalDocument.nets).toHaveLength(2);
  });

  it("rejects a whole-Net name merge across incompatible power roles", () => {
    const document = createEmptyDocument("main", "Main");
    addSupply(document, "V1", "vdd", "POWER");
    document.instances.push({ id: "G1", symbolId: "ground", placement: null });
    document.nets.push({
      id: "gnd",
      terminals: [{ instanceId: "G1", pinName: "0" }],
    });
    document.connectivityEvidence.push({
      id: "claim-gnd",
      kind: "name-claim",
      netId: "gnd",
      name: "0",
      scope: "global",
      powerDomain: "ground",
      owner: { kind: "power-marker", objectId: "G1" },
    });
    expect(planLogicalNetRename(document, "gnd", "POWER", "global")).toEqual({
      status: "rejected",
      message: "Cannot merge Net names with incompatible power roles",
    });
  });
  it("keeps a supply label's stored look in step with a marker rename", () => {
    const document = createEmptyDocument("main", "Main");
    addSupply(document, "V1", "net-v1");
    addSupplyLabel(document, "V1", "net-v1");
    const labelFormat = (renamed: string) => {
      const planned = planElectricalMarkerRename(document, "V1", renamed);
      if (planned.status !== "ready") throw new Error(planned.status);
      const result = gateRoutingOperationPlan(document, planned.plan, {
        symbolResolver: resolver,
      });
      if (!result.ok) throw new Error(result.message);
      return result.evaluated.finalDocument.annotations.find(
        (annotation) => annotation.id === "power-label-v1",
      )?.formatOverride;
    };
    expect(labelFormat("VCC")).toEqual(supplyLabelFormat("VCC"));
    // No V-led spelling: the label falls back to the ordinary name rules.
    expect(labelFormat("AVDD")).toBeUndefined();
  });

  it("renames a Net whose supply marker label stores its look", () => {
    const document = createEmptyDocument("main", "Main");
    addSupply(document, "V1", "net-v1");
    addSupplyLabel(document, "V1", "net-v1");
    const source =
      resolveDocumentLogicalNets(document).byBaseNetId.get("net-v1")!;
    const planned = planLogicalNetRename(document, source.id, "VDDA");
    if (planned.status !== "ready") throw new Error(planned.status);
    const result = gateRoutingOperationPlan(document, planned.plan, {
      symbolResolver: resolver,
    });
    if (!result.ok) throw new Error(result.message);
    expect(
      result.evaluated.finalDocument.annotations[0]?.formatOverride,
    ).toEqual(supplyLabelFormat("VDDA"));
  });
});
