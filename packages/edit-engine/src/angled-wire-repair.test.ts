import { createEmptyDocument, createRoutePath } from "@icm/model";
import { resolveRouteGeometry } from "@icm/derived";
import { parseProject } from "@icm/project-protocol";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { planAngledWireRepairs } from "./angled-wire-repair.js";
import { executeTransaction } from "./transaction.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function addRoute(
  document: ReturnType<typeof createEmptyDocument>,
  input: {
    id: string;
    from: { x: number; y: number };
    to: { x: number; y: number };
    bends?: readonly { x: number; y: number }[];
    modes?: readonly ("manual" | "locked" | "trunk")[];
  },
): void {
  const netId = `net-${input.id}`;
  const fromId = `from-${input.id}`;
  const toId = `to-${input.id}`;
  document.nets.push({ id: netId, terminals: [] });
  document.junctions.push(
    { id: fromId, netId, position: input.from },
    { id: toId, netId, position: input.to },
  );
  const bends = input.bends ?? [];
  document.routes.push(
    createRoutePath({
      id: input.id,
      netId,
      start: { kind: "junction", junctionId: fromId },
      end: { kind: "junction", junctionId: toId },
      bends,
      modes:
        input.modes ??
        Array.from({ length: bends.length + 1 }, () => "manual" as const),
    }),
  );
}

function applyPlan(document: ReturnType<typeof createEmptyDocument>) {
  const plan = planAngledWireRepairs(document, resolver);
  const result = executeTransaction(
    document,
    {
      transactionId: "repair-angled-wires",
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "human", id: "human-test" },
      edits: plan.edits,
    },
    { symbolResolver: resolver },
  );
  if (!result.ok) {
    throw new Error(
      `${result.error.message}: ${result.diagnostics.map((item) => item.message).join("; ")}`,
    );
  }
  return { plan, document: result.document };
}

describe("angled wire repair", () => {
  it("repairs arbitrary angles while preserving orthogonal and 45-degree routes", () => {
    const document = createEmptyDocument("doc", "Angle repair");
    addRoute(document, {
      id: "horizontal",
      from: { x: 0, y: 0 },
      to: { x: 40, y: 0 },
    });
    addRoute(document, {
      id: "diagonal-45",
      from: { x: 0, y: 20 },
      to: { x: 30, y: 50 },
    });
    addRoute(document, {
      id: "arbitrary",
      from: { x: 0, y: 70 },
      to: { x: 40, y: 90 },
    });

    const { plan, document: repaired } = applyPlan(document);

    expect(plan).toMatchObject({
      angledSegmentCount: 1,
      repairableSegmentCount: 1,
      repairableRouteCount: 1,
      protectedRouteCount: 0,
    });
    expect(plan.edits).toHaveLength(1);
    expect(repaired.revision).toBe(1);
    expect(
      resolveRouteGeometry(
        repaired,
        resolver,
        repaired.routes.find((route) => route.id === "arbitrary")!,
      )?.centerline,
    ).toEqual([
      { x: 0, y: 70 },
      { x: 40, y: 70 },
      { x: 40, y: 90 },
    ]);
    expect(repaired.routes.find((route) => route.id === "diagonal-45")).toEqual(
      document.routes.find((route) => route.id === "diagonal-45"),
    );
  });

  it("keeps the incoming direction when repairing a legacy endpoint segment", () => {
    const document = createEmptyDocument("doc", "Path preserving repair");
    addRoute(document, {
      id: "vertical-then-angled",
      from: { x: 0, y: 0 },
      to: { x: 30, y: 60 },
      bends: [{ x: 0, y: 20 }],
    });

    const { document: repaired } = applyPlan(document);
    const route = repaired.routes[0]!;
    expect(resolveRouteGeometry(repaired, resolver, route)?.centerline).toEqual(
      [
        { x: 0, y: 0 },
        { x: 0, y: 60 },
        { x: 30, y: 60 },
      ],
    );
  });

  it("preserves an intentional 45-degree leg beside a repaired segment", () => {
    const document = createEmptyDocument("doc", "Mixed route repair");
    addRoute(document, {
      id: "mixed",
      from: { x: 0, y: 0 },
      to: { x: 50, y: 30 },
      bends: [{ x: 20, y: 20 }],
    });

    const { document: repaired } = applyPlan(document);
    const route = repaired.routes[0]!;
    expect(resolveRouteGeometry(repaired, resolver, route)?.centerline).toEqual(
      [
        { x: 0, y: 0 },
        { x: 20, y: 20 },
        { x: 50, y: 20 },
        { x: 50, y: 30 },
      ],
    );
  });

  it("reports locked and trunk routes without editing them", () => {
    const document = createEmptyDocument("doc", "Protected routes");
    addRoute(document, {
      id: "locked",
      from: { x: 0, y: 0 },
      to: { x: 40, y: 20 },
      modes: ["locked"],
    });
    addRoute(document, {
      id: "trunk",
      from: { x: 0, y: 40 },
      to: { x: 40, y: 60 },
      modes: ["trunk"],
    });

    const plan = planAngledWireRepairs(document, resolver);

    expect(plan.edits).toEqual([]);
    expect(plan.protectedRouteCount).toBe(2);
    expect(plan.issues).toEqual([
      { routeId: "locked", segmentIndexes: [0], protected: true },
      { routeId: "trunk", segmentIndexes: [0], protected: true },
    ]);
  });

  it("repairs several routes in one document revision", () => {
    const document = createEmptyDocument("doc", "Batch repair");
    addRoute(document, {
      id: "route-a",
      from: { x: 0, y: 0 },
      to: { x: 40, y: 20 },
    });
    addRoute(document, {
      id: "route-b",
      from: { x: 0, y: 40 },
      to: { x: 20, y: 80 },
    });

    const { plan, document: repaired } = applyPlan(document);

    expect(plan.edits).toHaveLength(2);
    expect(repaired.revision).toBe(1);
    for (const route of repaired.routes) {
      const geometry = resolveRouteGeometry(repaired, resolver, route)!;
      expect(
        geometry.segments.every(
          ({ from, to }) => from.x === to.x || from.y === to.y,
        ),
      ).toBe(true);
    }
  });

  it("cleans the historical pin-drift pattern without changing connectivity", () => {
    const document = parseProject(
      readFileSync("fixtures/gallery-redline/3tfmrzevfe.icproj.json", "utf8"),
    ).documents[0]!;
    const originalNets = structuredClone(document.nets);

    const { plan, document: repaired } = applyPlan(document);

    expect(plan.angledSegmentCount).toBe(2);
    expect(repaired.nets).toEqual(originalNets);
    expect(planAngledWireRepairs(repaired, resolver).angledSegmentCount).toBe(
      0,
    );
    expect(
      resolveRouteGeometry(
        repaired,
        resolver,
        repaired.routes.find(
          (route) => route.id === "route-ui-38-a-contact-p1-p",
        )!,
      )?.centerline,
    ).toEqual([
      { x: 220, y: 400 },
      { x: 200, y: 400 },
      { x: 200, y: 450 },
    ]);
  });
});
