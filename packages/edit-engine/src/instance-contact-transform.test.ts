import {
  createEmptyDocument,
  createRoutePath,
  type SchematicDocument,
} from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import {
  deriveDocumentContactEvidence,
  contactRequiresJunctionDot,
  resolveEndpointConnection,
  endpointKey,
} from "@icm/derived";
import { describe, expect, it } from "vitest";
import { planInstanceContactTransform } from "./instance-contact-transform.js";
import { gateRoutingOperationPlan } from "./routing-operation-plan.js";
import { executeTransaction } from "./transaction.js";
import {
  proposePlacementContact,
  placementWireSources,
} from "./instance-contact-planner.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
function fixture(): SchematicDocument {
  const d = createEmptyDocument("contact-transform", "Contact transform");
  for (const [id, x, y] of [
    ["L", 0, 20],
    ["R", 200, 20],
    ["X", 100, 120],
  ] as const) {
    d.instances.push({
      id,
      symbolId: "resistor",
      reference: id,
      netlist: { parameters: {} },
      placement: { position: { x, y }, rotation: 0, mirror: "none" },
    });
  }
  for (const pinName of ["1", "2"]) {
    const netId = "net-" + pinName;
    d.nets.push({
      id: netId,
      terminals: [
        { instanceId: "L", pinName },
        { instanceId: "R", pinName },
      ],
    });
    d.routes.push(
      createRoutePath({
        id: "wire-" + pinName,
        netId,
        start: { kind: "terminal", instanceId: "L", pinName },
        end: { kind: "terminal", instanceId: "R", pinName },
        bends: [],
        modes: ["manual"],
      }),
    );
  }
  return d;
}
function move(
  d: SchematicDocument,
  delta: { x: number; y: number },
  connect = true,
) {
  const plan = planInstanceContactTransform(
    d,
    resolver,
    { instanceIds: ["X"], routeIds: [], junctionIds: [] },
    delta,
    connect,
  );
  const result = gateRoutingOperationPlan(d, plan, {
    symbolResolver: resolver,
  });
  if (!result.ok) throw new Error(result.message);
  const commit = executeTransaction(
    d,
    {
      transactionId: "commit",
      documentId: d.id,
      expectedRevision: d.revision,
      actor: { kind: "human", id: "test" },
      edits: [...plan.edits],
    },
    { symbolResolver: resolver },
  );
  if (!commit.ok) throw new Error(commit.error.message);
  expect(commit.document).toEqual(result.evaluated.finalDocument);
  return commit.document;
}
describe("final-position contact transform", () => {
  it("connects every contacted pin across different wires, just like placement", () => {
    const d = fixture();
    const moved = move(d, { x: 0, y: -100 });
    for (const pinName of ["1", "2"]) {
      expect(
        moved.nets.find((n) => n.id === "net-" + pinName)!.terminals,
      ).toContainEqual({ instanceId: "X", pinName });
      const actual = deriveDocumentContactEvidence(
        moved,
        resolver,
      ).byEndpointKey.get(
        endpointKey({ kind: "terminal", instanceId: "X", pinName }),
      );
      expect(actual && contactRequiresJunctionDot(actual)).toBe(true);
    }
    const instance = structuredClone(d.instances.find((i) => i.id === "X")!);
    instance.placement!.position.y = 20;
    const proposal = proposePlacementContact(
      d,
      resolver,
      instance,
      d.instances
        .filter((i) => i.id !== "X")
        .flatMap((i) => placementWireSources(d, resolver, i)),
    );
    expect(proposal.matched).toBe(true);
    expect(
      proposal.edits.filter((e) => e.kind === "attach_endpoint_to_route"),
    ).toHaveLength(2);
  });
  it("can leave and return to the original pin-on-wire contacts repeatedly", () => {
    let d = move(fixture(), { x: 0, y: -100 });
    for (let i = 0; i < 3; i++) {
      d = move(d, { x: 40, y: 30 });
      d = move(d, { x: -40, y: -30 });
      expect(
        d.instances.find((i) => i.id === "X")!.placement!.position,
      ).toEqual({ x: 100, y: 20 });
      for (const pinName of ["1", "2"])
        expect(
          d.nets.find((n) => n.id === "net-" + pinName)!.terminals,
        ).toContainEqual({ instanceId: "X", pinName });
    }
  });
  it("does not connect a geometrically coincident passive move", () => {
    const d = move(fixture(), { x: 0, y: -100 }, false);
    expect(
      d.nets.every((n) => n.terminals.every((t) => t.instanceId !== "X")),
    ).toBe(true);
    expect(
      resolveEndpointConnection(d, resolver, {
        kind: "terminal",
        instanceId: "X",
        pinName: "1",
      })?.contactPoint,
    ).toEqual({ x: 100, y: 0 });
  });
  it("folds repeated Net joins before splitting several moved pins onto the same conductor", () => {
    const d = fixture();
    d.instances.push({
      ...structuredClone(d.instances[2]!),
      id: "Y",
      reference: "Y",
      placement: { position: { x: 150, y: 120 }, rotation: 0, mirror: "none" },
    });
    d.nets.push({
      id: "moving-net",
      terminals: [
        { instanceId: "X", pinName: "1" },
        { instanceId: "Y", pinName: "1" },
      ],
    });
    d.routes.push(
      createRoutePath({
        id: "moving-wire",
        netId: "moving-net",
        start: { kind: "terminal", instanceId: "X", pinName: "1" },
        end: { kind: "terminal", instanceId: "Y", pinName: "1" },
        bends: [],
        modes: ["manual"],
      }),
    );
    const plan = planInstanceContactTransform(
      d,
      resolver,
      { instanceIds: ["X", "Y"], routeIds: [], junctionIds: [] },
      { x: 0, y: -100 },
      true,
    );
    const result = gateRoutingOperationPlan(d, plan, {
      symbolResolver: resolver,
    });
    if (!result.ok) throw new Error(result.message);
    expect(plan.diagnostics).toEqual([]);
    expect(plan.edits.filter((e) => e.kind === "merge_nets")).toHaveLength(1);
    for (const pinName of ["1", "2"]) {
      const net = result.evaluated.finalDocument.nets.find((n) =>
        n.terminals.some((t) => t.instanceId === "L" && t.pinName === pinName),
      )!;
      for (const instanceId of ["X", "Y"])
        expect(net.terminals).toContainEqual({ instanceId, pinName });
    }
  });
});
