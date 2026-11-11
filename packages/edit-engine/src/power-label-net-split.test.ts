import {
  createEmptyDocument,
  createRoutePath,
  semanticTextDocument,
  type RouteEndpoint,
  type SchematicDocument,
} from "@icm/model";
import {
  resolveDocumentLogicalNets,
  resolveEndpointConnection,
} from "@icm/derived";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";
import { executeTransaction, type SchematicEdit } from "./transaction.js";
import { planRoutingDeletion } from "./routing-deletion-planner.js";
import { gateRoutingOperationPlan } from "./routing-operation-plan.js";
import { retargetOwnerEvidenceAfterSplit } from "./transaction-connectivity.js";

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

describe("a label on a part with several pins", () => {
  it("stays on the Net where its part has a pin, not the part's first Net", () => {
    // The process ties R1's body B, a property pin, to ground through a
    // hidden label on R1. Pin 1's Net sorts first by id; a label that
    // followed the part's first Net put ground on pin 1.
    const document = createEmptyDocument("main", "Main");
    document.instances.push({
      id: "R1",
      reference: "R1",
      symbolId: "resistor",
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      netlist: { parameters: { value: "1k" } },
    });
    document.nets.push(
      { id: "a-signal", terminals: [{ instanceId: "R1", pinName: "1" }] },
      { id: "substrate", terminals: [{ instanceId: "R1", pinName: "B" }] },
    );
    document.annotations.push({
      id: "substrate-label",
      kind: "net-label",
      netId: "substrate",
      binding: { kind: "net-name", netId: "substrate" },
      visible: false,
      anchor: {
        kind: "object",
        objectId: "R1",
        localOffset: { x: 0, y: 0 },
        fallbackPosition: { x: 0, y: 0 },
      },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    document.connectivityEvidence.push({
      id: "substrate-name",
      kind: "name-claim",
      netId: "substrate",
      name: "0",
      scope: "global",
      powerDomain: "ground",
      owner: { kind: "net-label", annotationId: "substrate-label" },
    });
    const changed = new Set<string>();
    for (const net of document.nets)
      retargetOwnerEvidenceAfterSplit(document, net.id, changed);
    expect(document.annotations[0]!.netId).toBe("substrate");
    expect(document.annotations[0]!.binding).toEqual({
      kind: "net-name",
      netId: "substrate",
    });
    expect(document.connectivityEvidence[0]!.netId).toBe("substrate");
    expect(changed).toEqual(new Set());
  });
});

describe("pins no one can draw across a physical cut (#2254)", () => {
  /** R1 and R2 hang from a rail; X1's hidden VDD is on the rail's Net. */
  function railWithHiddenSupply() {
    const document = createEmptyDocument("main", "Main");
    document.presentation.grid = 10;
    document.instances.push(
      ...(["R1", "R2"] as const).map((id, index) => ({
        id,
        reference: id,
        symbolId: "resistor",
        placement: {
          position: { x: 140, y: 300 + 100 * index },
          rotation: 0 as const,
          mirror: "none" as const,
        },
        netlist: { parameters: { value: "1k" } },
      })),
      {
        id: "X1",
        reference: "X1",
        symbolId: "opamp",
        placement: {
          position: { x: 400, y: 500 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    const pin = (instanceId: string) => ({
      kind: "terminal" as const,
      instanceId,
      pinName: "1",
    });
    document.nets.push({
      id: "VDD",
      terminals: [
        { instanceId: "R1", pinName: "1" },
        { instanceId: "R2", pinName: "1" },
        { instanceId: "X1", pinName: "VDD" },
      ],
    });
    const tapPoint = (instanceId: string) => {
      const connection = resolveEndpointConnection(
        document,
        resolver,
        pin(instanceId),
      )!;
      return {
        x: connection.contactPoint.x + connection.outward!.x * 40,
        y: connection.contactPoint.y + connection.outward!.y * 40,
      };
    };
    const t1 = tapPoint("R1");
    document.junctions.push(
      {
        id: "start",
        netId: "VDD",
        position: { x: t1.x, y: t1.y - 20 },
        role: "route-anchor",
      },
      { id: "tap1", netId: "VDD", position: t1 },
      {
        id: "end",
        netId: "VDD",
        position: tapPoint("R2"),
        role: "route-anchor",
      },
    );
    const path = (
      id: string,
      start: RouteEndpoint,
      end: RouteEndpoint,
      presentation?: "power-rail",
    ) =>
      createRoutePath({
        id,
        netId: "VDD",
        start,
        end,
        bends: [],
        modes: ["manual"],
        ...(presentation ? { presentation } : {}),
      });
    const junction = (junctionId: string) => ({
      kind: "junction" as const,
      junctionId,
    });
    document.routes.push(
      path("rail-a", junction("start"), junction("tap1"), "power-rail"),
      path("rail-b", junction("tap1"), junction("end"), "power-rail"),
      path("tap-r1", pin("R1"), junction("tap1")),
      path("tap-r2", pin("R2"), junction("end")),
    );
    return document;
  }

  const netOf = (
    document: SchematicDocument,
    instanceId: string,
    pinName: string,
  ) =>
    document.nets.find((net) =>
      net.terminals.some(
        (terminal) =>
          terminal.instanceId === instanceId && terminal.pinName === pinName,
      ),
    )?.id;

  it("keeps an op-amp's hidden VDD on the rail when another tap is deleted", () => {
    const document = railWithHiddenSupply();
    const plan = planRoutingDeletion(
      document,
      resolver,
      { instanceIds: [], routeIds: ["tap-r2"], junctionIds: [] },
      1,
    );
    const result = gateRoutingOperationPlan(document, plan, {
      symbolResolver: resolver,
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    const after = result.evaluated.finalDocument;
    // Only R2 leaves: its tap was the deleted wire.
    expect(netOf(after, "X1", "VDD")).toBe(netOf(after, "R1", "1"));
    expect(netOf(after, "R2", "1")).not.toBe(netOf(after, "R1", "1"));
  });

  it("leaves a hidden label on its own empty Net when a wire is deleted", () => {
    // A process label on R1 names a Net that holds nothing (the part's
    // substrate went elsewhere). Rebuilding after a cut moved it onto R1's
    // first Net, which already had a name, and every edit was refused.
    const document = railWithHiddenSupply();
    document.nets.push(
      { id: "a-signal", terminals: [{ instanceId: "R1", pinName: "2" }] },
      { id: "substrate", terminals: [] },
    );
    document.annotations.push({
      id: "signal-label",
      kind: "net-label",
      netId: "a-signal",
      binding: { kind: "net-name", netId: "a-signal" },
      anchor: { kind: "free", position: { x: 0, y: 0 } },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    document.connectivityEvidence.push({
      id: "signal-name",
      kind: "name-claim",
      netId: "a-signal",
      name: "VIN",
      scope: "local",
      owner: { kind: "net-label", annotationId: "signal-label" },
    });
    document.annotations.push({
      id: "substrate-label",
      kind: "net-label",
      netId: "substrate",
      binding: { kind: "net-name", netId: "substrate" },
      visible: false,
      anchor: {
        kind: "object",
        objectId: "R1",
        localOffset: { x: 0, y: 0 },
        fallbackPosition: { x: 0, y: 0 },
      },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    document.connectivityEvidence.push({
      id: "substrate-name",
      kind: "name-claim",
      netId: "substrate",
      name: "0",
      scope: "global",
      powerDomain: "ground",
      owner: { kind: "net-label", annotationId: "substrate-label" },
    });
    const plan = planRoutingDeletion(
      document,
      resolver,
      { instanceIds: [], routeIds: ["tap-r2"], junctionIds: [] },
      1,
    );
    const result = gateRoutingOperationPlan(document, plan, {
      symbolResolver: resolver,
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    const after = result.evaluated.finalDocument;
    expect(
      after.annotations.find((a) => a.id === "substrate-label")?.netId,
    ).toBe("substrate");
    expect(
      after.connectivityEvidence.find((e) => e.id === "substrate-name")?.netId,
    ).toBe("substrate");
  });
});
