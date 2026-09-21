import {
  createEmptyDocument,
  createRoutePath,
  semanticTextDocument,
} from "@icm/model";
import { resolveDocumentLogicalNets } from "@icm/derived";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";
import { executeTransaction, type SchematicEdit } from "./transaction.js";
import { planRoutingDeletion } from "./routing-deletion-planner.js";
import { gateRoutingOperationPlan } from "./routing-operation-plan.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

describe("power label ownership across a physical cut", () => {
  it.each([
    { reverse: false, styled: false },
    { reverse: false, styled: true },
    { reverse: true, styled: false },
    { reverse: true, styled: true },
  ])(
    "deletes a transistor-to-supply wire without losing its label (reverse: $reverse, styled: $styled)",
    ({ reverse, styled }) => {
      const document = createEmptyDocument("main", "Main");
      document.instances.push(
        {
          id: "M1",
          symbolId: "nmos",
          symbolVariantId: "textbook-3terminal",
          placement: {
            position: { x: -130, y: 10 },
            rotation: 0,
            mirror: "none",
          },
        },
        {
          id: "VDD1",
          symbolId: "vdd-port",
          placement: {
            position: { x: -120, y: -40 },
            rotation: 0,
            mirror: "none",
          },
        },
      );
      const transistor = { instanceId: "M1", pinName: "D" };
      const supply = { instanceId: "VDD1", pinName: "P" };
      document.nets.push({ id: "supply", terminals: [transistor, supply] });
      document.routes.push(
        createRoutePath({
          id: "short",
          netId: "supply",
          start: { kind: "terminal", ...(reverse ? supply : transistor) },
          end: { kind: "terminal", ...(reverse ? transistor : supply) },
          bends: [],
          modes: ["manual"],
        }),
      );
      document.connectivityEvidence.push({
        id: "supply-name",
        kind: "name-claim",
        netId: "supply",
        name: "V_IN",
        scope: "global",
        powerDomain: "vdd",
        // The symbol owns the name; its text is a separate bound annotation.
        owner: { kind: "power-marker", objectId: "VDD1" },
      });
      const label = {
        id: "power-label-vdd1",
        kind: "power-label" as const,
        netId: "supply",
        binding: { kind: "net-name" as const, netId: "supply" },
        ...(styled
          ? { formatOverride: semanticTextDocument("V_IN", "net-label") }
          : {}),
        anchor: {
          kind: "object" as const,
          objectId: "VDD1",
          localOffset: { x: 20, y: 10 },
          fallbackPosition: { x: -100, y: -30 },
        },
        alignment: "start" as const,
        rotation: 0 as const,
        locked: false,
      };
      document.annotations.push(label);
      const original = structuredClone(document);
      const plan = planRoutingDeletion(
        document,
        resolver,
        { instanceIds: [], routeIds: ["short"], junctionIds: [] },
        1,
      );
      const result = gateRoutingOperationPlan(document, plan, {
        symbolResolver: resolver,
      });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (!result.ok) return;
      const after = result.evaluated.finalDocument;
      const supplyNet = after.nets.find((net) =>
        net.terminals.some((terminal) => terminal.instanceId === "VDD1"),
      )!;
      const drainNet = after.nets.find((net) =>
        net.terminals.some((terminal) => terminal.instanceId === "M1"),
      )!;
      expect(after.routes).toEqual([]);
      expect(after.instances).toEqual(document.instances);
      expect(supplyNet.id === "supply").toBe(reverse);
      expect(supplyNet.id).not.toBe(drainNet.id);
      expect(after.annotations).toEqual([
        {
          ...label,
          netId: supplyNet.id,
          binding: { kind: "net-name", netId: supplyNet.id },
        },
      ]);
      const logical = resolveDocumentLogicalNets(after).byBaseNetId;
      expect(logical.get(supplyNet.id)?.name).toBe("V_IN");
      expect(logical.get(drainNet.id)?.name).toBeUndefined();
      expect(document).toEqual(original);
    },
  );

  it.each([false, true])(
    "keeps the rail, label and formal terminal together (rail retains old Net: %s)",
    (reverse) => {
      let document = createEmptyDocument("main", "Main");
      const apply = (edits: SchematicEdit[]) => {
        const result = executeTransaction(
          document,
          {
            transactionId: `edit-${document.revision}`,
            documentId: document.id,
            expectedRevision: document.revision,
            actor: { kind: "human", id: "test" },
            edits,
          },
          { symbolResolver: resolver },
        );
        expect(result.ok, JSON.stringify(result)).toBe(true);
        if (!result.ok) throw new Error(result.error.message);
        document = result.document;
      };
      apply([
        {
          kind: "add_power_rail",
          netId: "supply",
          routeId: "rail",
          startJunctionId: "rail-start",
          endJunctionId: "rail-end",
          labelId: "label",
          netName: "VDD",
          scope: "local",
          powerDomain: "vdd",
          start: { x: 0, y: 0 },
          end: { x: 100, y: 0 },
        },
      ]);
      const a = { kind: "junction" as const, junctionId: "signal-a" };
      const b = { kind: "junction" as const, junctionId: "rail-start" };
      apply([
        {
          kind: "add_junction",
          netId: "supply",
          junctionId: "signal-a",
          position: { x: 0, y: 100 },
        },
        {
          kind: "add_junction",
          netId: "supply",
          junctionId: "signal-b",
          position: { x: 100, y: 100 },
        },
        {
          kind: "set_route_path",
          route: createRoutePath({
            id: "signal",
            netId: "supply",
            start: a,
            end: { kind: "junction", junctionId: "signal-b" },
            bends: [],
            modes: ["manual"],
          }),
        },
        {
          kind: "set_route_path",
          route: createRoutePath({
            id: "short",
            netId: "supply",
            start: reverse ? b : a,
            end: reverse ? a : b,
            bends: [],
            modes: ["manual"],
          }),
        },
      ]);
      apply([{ kind: "cut_connection", routeId: "short" }]);
      const railNet = document.routes.find((r) => r.id === "rail")!.netId;
      const signalNet = document.routes.find((r) => r.id === "signal")!.netId;
      expect(railNet).not.toBe(signalNet);
      expect(railNet === "supply").toBe(reverse);
      expect(document.annotations.find((a) => a.id === "label")?.netId).toBe(
        railNet,
      );
      expect(document.netlist?.terminals[0]?.netId).toBe(railNet);
      expect(
        document.connectivityEvidence.find(
          (e) => e.kind === "name-claim" && e.name === "VDD",
        )?.netId,
      ).toBe(railNet);
      expect(
        document.annotations.find((a) => a.id === "label")?.binding?.kind,
      ).toBe("cell-terminal-name");
    },
  );
});
