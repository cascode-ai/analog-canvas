import { createEmptyDocument, type SchematicDocument } from "@icm/model";
import { deriveVisibleConnectivity } from "@icm/derived";
import {
  builtInSymbols,
  InMemorySymbolResolver,
  createProjectSymbolResolver,
} from "@icm/symbols";
import { describe, expect, it } from "vitest";
import { importSpiceSources } from "../../spice/src/importer.js";
import { DocumentHistory } from "./history.js";
import { planRouteNet, type RouteNetTarget } from "./route-net-planner.js";
import type { SchematicEdit } from "./edit-schema.js";
import { planWireBatch } from "./wire-batch-planner.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
function fixture() {
  const document = createEmptyDocument("doc", "Route Net");
  document.instances = [0, 1, 2, 3].map((index) => ({
    id: `R${index}`,
    reference: `R${index}`,
    symbolId: "resistor",
    placement: {
      position: { x: index * 100, y: 100 },
      rotation: 0,
      mirror: "none",
    },
  }));
  const pins = document.instances.map((instance) => ({
    instanceId: instance.id,
    pinName: "1",
  }));
  const target: RouteNetTarget = { kind: "pins", pins };
  return { document, pins, target };
}
function apply(document: SchematicDocument, edits: SchematicEdit[]) {
  const history = new DocumentHistory(document, { symbolResolver: resolver });
  const result = history.transact({
    transactionId: "route-net",
    documentId: document.id,
    expectedRevision: document.revision,
    actor: { kind: "agent", id: "test" },
    edits,
  });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return history;
}
describe("route-net", () => {
  it("does not bypass an ambiguous foreign wire at a reused trunk-end pin", () => {
    const { document, target } = fixture();
    const foreign = planWireBatch(
      document,
      resolver,
      [
        {
          id: "foreign",
          from: { kind: "free", point: { x: 0, y: 50 } },
          to: { kind: "free", point: { x: 0, y: 110 } },
        },
      ],
      64,
    );
    if (typeof foreign === "string") throw new Error(foreign);
    const current = apply(document, foreign.edits).document;
    expect(current.nets.flatMap((net) => net.terminals)).toEqual([]);
    const before = structuredClone(current);
    expect(() =>
      planRouteNet(
        current,
        resolver,
        {
          target,
          trunk: { start: { x: 0, y: 80 }, end: { x: 300, y: 80 } },
        },
        64,
      ),
    ).toThrow(/different Net|Ambiguous wire crossing/);
    expect(current).toEqual(before);
  });
  it.each([50, 100])(
    "allows plain crossings but refuses a foreign Net at a tap (x=%i)",
    (x) => {
      const { document, target } = fixture();
      const foreign = planWireBatch(
        document,
        resolver,
        [
          {
            id: "foreign",
            from: { kind: "free", point: { x, y: -30 } },
            to: { kind: "free", point: { x, y: 30 } },
          },
        ],
        64,
      );
      if (typeof foreign === "string") throw new Error(foreign);
      const current = apply(document, foreign.edits).document;
      const before = structuredClone(current);
      const input = {
        target,
        trunk: { start: { x: -40, y: 0 }, end: { x: 360, y: 0 } },
      };
      if (x === 100) {
        expect(() => planRouteNet(current, resolver, input, 64)).toThrow(
          /different Net|Ambiguous wire crossing/,
        );
        expect(current).toEqual(before);
      } else {
        const next = apply(
          current,
          planRouteNet(current, resolver, input, 64).edits,
        ).document;
        expect(next.nets).toHaveLength(2);
        expect(
          next.junctions.some(
            (junction) =>
              junction.position.x === 50 && junction.position.y === 0,
          ),
        ).toBe(false);
      }
    },
  );
  it("connects explicit pins once, skips existing routes on repeat and supports one undo", () => {
    const { document, pins, target } = fixture();
    const before = structuredClone(document);
    const plan = planRouteNet(document, resolver, { target }, 64);
    expect(document).toEqual(before);
    const history = apply(document, plan.edits);
    expect(history.document.nets).toHaveLength(1);
    expect(history.document.nets[0]!.terminals).toHaveLength(pins.length);
    expect(
      deriveVisibleConnectivity(history.document, resolver)[0]!.components,
    ).toHaveLength(1);
    expect(
      planRouteNet(history.document, resolver, { target }, 64).edits,
    ).toEqual([]);
    expect(
      history.transact({
        transactionId: "undo",
        documentId: document.id,
        expectedRevision: history.document.revision,
        actor: { kind: "human", id: "test" },
        edits: [{ kind: "undo" }],
      }).ok,
    ).toBe(true);
    expect(history.document.instances).toEqual(before.instances);
    expect(history.document.routes).toEqual([]);
    expect(history.document.nets).toEqual([]);
  });

  it.each(["net", "member"] as const)(
    "routes a current %s target and keeps the preexisting segment",
    (kind) => {
      const { document, pins } = fixture();
      const first = apply(
        document,
        planRouteNet(
          document,
          resolver,
          { target: { kind: "pins", pins: pins.slice(0, 2) } },
          64,
        ).edits,
      ).document;
      const net = first.nets[0]!;
      net.terminals.push(...pins.slice(2));
      first.annotations.push({
        id: "label",
        kind: "net-label",
        netId: net.id,
        binding: { kind: "net-name", netId: net.id },
        anchor: {
          kind: "object",
          objectId: "R0",
          localOffset: { x: 0, y: 0 },
          fallbackPosition: { x: 0, y: 100 },
        },
        alignment: "start",
        rotation: 0,
        locked: false,
      });
      first.connectivityEvidence.push({
        id: "claim",
        kind: "name-claim",
        netId: net.id,
        name: "BUS",
        owner: { kind: "net-label", annotationId: "label" },
        scope: "local",
      });
      const routes = structuredClone(first.routes);
      const target: RouteNetTarget =
        kind === "net" ? { kind, net: "BUS" } : { kind, ...pins[0]! };
      const next = apply(
        first,
        planRouteNet(first, resolver, { target }, 64).edits,
      ).document;
      for (const route of routes) expect(next.routes).toContainEqual(route);
      expect(
        deriveVisibleConnectivity(next, resolver)[0]!.components,
      ).toHaveLength(1);
    },
  );

  it("uses one explicit trunk with evolving taps and rejects insufficient capacity atomically", () => {
    const { document, target } = fixture();
    const input = {
      target,
      trunk: { start: { x: -40, y: 0 }, end: { x: 360, y: 0 } },
    };
    const before = structuredClone(document);
    expect(() => planRouteNet(document, resolver, input, 3)).toThrow(/limit/);
    expect(document).toEqual(before);
    const next = apply(
      document,
      planRouteNet(document, resolver, input, 64).edits,
    ).document;
    expect(next.nets).toHaveLength(1);
    expect(next.nets[0]!.terminals).toHaveLength(4);
    expect(
      deriveVisibleConnectivity(next, resolver)[0]!.components,
    ).toHaveLength(1);
    expect(planRouteNet(next, resolver, input, 64).edits).toEqual([]);
  });

  it("reports missing or unplaced pins instead of claiming partial completion", () => {
    const { document, pins } = fixture();
    expect(() =>
      planRouteNet(
        document,
        resolver,
        { target: { kind: "net", net: "unknown" } },
        64,
      ),
    ).toThrow("found 0");
    expect(() =>
      planRouteNet(
        document,
        resolver,
        {
          target: {
            kind: "pins",
            pins: [pins[0]!, { instanceId: "missing", pinName: "1" }],
          },
        },
        64,
      ),
    ).toThrow("Missing route-net pin");
    document.instances[1]!.placement = null;
    expect(() =>
      planRouteNet(document, resolver, { target: { kind: "pins", pins } }, 64),
    ).toThrow("Place R1");
    expect(document.routes).toEqual([]);
  });

  it("resolves an imported reference identity without treating it as a live Net ID", async () => {
    const source =
      "* topology-only routing regression\nR1 A B 1k\nR2 A C 2k\nR3 A D 3k\n.end\n";
    const { project } = await importSpiceSources(
      [{ path: "test.cir", bytes: new TextEncoder().encode(source) }],
      "test.cir",
    );
    expect(project).toBeTruthy();
    const document = project!.documents.find(
      (item) => item.id === project!.topDocumentId,
    )!;
    document.instances.forEach((instance, index) => {
      instance.placement = {
        position: { x: index * 100, y: 100 },
        rotation: 0,
        mirror: "none",
      };
    });
    const sourceNet = document.importReference!.nets.find(
      (net) => net.name === "A",
    )!;
    const projectResolver = createProjectSymbolResolver(
      project!,
      builtInSymbols,
    );
    const plan = planRouteNet(
      document,
      projectResolver,
      { target: { kind: "import-net", sourceNetId: sourceNet.id } },
      64,
    );
    expect(plan.edits.length).toBeGreaterThan(0);
    const history = new DocumentHistory(document, {
      symbolResolver: projectResolver,
    });
    expect(
      history.transact({
        transactionId: "import-route",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "agent", id: "test" },
        edits: plan.edits,
      }).ok,
    ).toBe(true);
    expect(
      planRouteNet(
        history.document,
        projectResolver,
        { target: { kind: "import-net", sourceNetId: sourceNet.id } },
        64,
      ).edits,
    ).toEqual([]);
  });
});
