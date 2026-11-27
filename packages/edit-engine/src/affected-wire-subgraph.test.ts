import * as model from "@icm/model";
import { executeTransaction } from "./transaction.js";
import { planRoutingDeletion } from "./routing-deletion-planner.js";
import {
  createEmptyProject,
  createEmptyDocument,
  createRoutePath,
  parseProjectSnapshot,
  freezeSnapshot,
  type SchematicDocument,
  type RouteEndpoint,
} from "@icm/model";
import { buildProjectConnectivityIndex } from "@icm/derived";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { expect, it, vi } from "vitest";
import { proposeWireIntent } from "./wire-intent-planner.js";
import {
  createRoutingOperationPlan,
  gateRoutingOperationPlan,
  gateCanvasWireCommit,
} from "./routing-operation-plan.js";
import { adoptPreparedCanvasTransaction } from "./prepared-transaction.js";
import * as routing from "./transaction-routing.js";
import * as phase from "./connectivity-phase-read.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const context = { symbolResolver: resolver };
const junction = (junctionId: string) => ({
  kind: "junction" as const,
  junctionId,
});

function drawing(background: number, branches: number) {
  const project = createEmptyProject("test", "Wires", "main");
  const d = project.documents[0]!;
  function arm(id: string, y: number, count: number) {
    d.nets.push({ id, terminals: [] });
    for (let i = 0; i <= count; i++) {
      d.junctions.push({
        id: id + "j" + i,
        netId: id,
        position: { x: i * 20, y },
        role: "route-anchor",
      });
      if (i)
        d.routes.push(
          createRoutePath({
            id: id + "r" + i,
            netId: id,
            start: junction(id + "j" + (i - 1)),
            end: junction(id + "j" + i),
            bends: [],
            modes: ["manual"],
          }),
        );
    }
  }
  arm("a", 0, branches);
  arm("b", 100, 1);
  for (let i = 0; i < background; i++) arm("unrelated" + i, 1000 + i * 100, 1);
  return project;
}
function connect(
  doc: SchematicDocument,
  target: RouteEndpoint = junction("bj0"),
) {
  const proposal = proposeWireIntent(doc, resolver, {
    id: "join",
    from: { kind: "endpoint", endpoint: junction("aj0") },
    to: { kind: "endpoint", endpoint: target },
  });
  if (typeof proposal === "string") throw Error(proposal);
  return createRoutingOperationPlan(doc, {
    intent: "connect",
    edits: proposal.edits,
    diagnostics: [],
  });
}
function measure(
  background: number,
  branches: number,
  known = true,
  setup?: (project: ReturnType<typeof drawing>) => void,
  target?: RouteEndpoint,
) {
  const source = drawing(background, branches);
  setup?.(source);
  const project = (known ? parseProjectSnapshot : freezeSnapshot)(source);
  const doc = project.documents[0]!;
  buildProjectConnectivityIndex(project, resolver);
  const context = {
    symbolResolver: resolver,
    externalSubcircuitDefinitions: project.externalSubcircuitDefinitions,
  };
  const plan = connect(doc, target);
  const oracle = gateRoutingOperationPlan(structuredClone(doc), plan, context);
  if (!oracle.ok) throw Error(oracle.message);
  const geometry = vi.spyOn(routing, "validateRoute"),
    membership = vi.spyOn(phase, "prepareConnectivityPhaseRead");
  try {
    const gate = gateCanvasWireCommit(doc, plan, context);
    if (!gate.ok) throw Error(gate.message);
    const result = adoptPreparedCanvasTransaction(
      doc,
      gate.edits,
      gate.preparedTransaction,
      context,
    );
    if (!result.ok) throw Error(result.error.message);
    expect(result.document).toEqual(oracle.evaluated.finalDocument);
    expect(result.diff).toEqual(oracle.evaluated.diff);
    return {
      checked: geometry.mock.calls.map((call) => call[1].id),
      phaseRoutes: membership.mock.calls.flatMap((call) =>
        call[0].routes.map((r) => r.id),
      ),
    };
  } finally {
    geometry.mockRestore();
    membership.mockRestore();
  }
}
it("checks geometry and physical connectivity of both joined trees as unrelated Nets grow", () => {
  const a = measure(2, 3),
    b = measure(24, 3);
  expect(b.checked).toEqual(a.checked);
  expect(b.phaseRoutes).toEqual(a.phaseRoutes);
  expect(b.checked).not.toContain("unrelated0r1");
  expect(b.phaseRoutes).toContain("ar3");
  expect(b.phaseRoutes).toContain("br1");
  expect(measure(2, 8).phaseRoutes.length).toBeGreaterThan(
    a.phaseRoutes.length,
  );
});

it("keeps the full check for a frozen Cell without validated membership provenance", () => {
  const checked = measure(5, 3, false);
  expect(checked.checked).toContain("unrelated4r1");
  expect(checked.phaseRoutes).toContain("unrelated4r1");
});

it("follows both branches after a cut and preserves the complete ordered transaction", () => {
  const p = drawing(20, 4),
    d = p.documents[0]!;
  const twig = (id: string, from: string, x: number) => {
    d.junctions.push({
      id,
      netId: "a",
      position: { x, y: 30 },
      role: "route-anchor",
    });
    d.routes.push(
      createRoutePath({
        id: id + "-wire",
        netId: "a",
        start: junction(from),
        end: junction(id),
        bends: [],
        modes: ["manual"],
      }),
    );
  };
  twig("left", "aj1", 20);
  twig("right", "aj3", 60);
  const owned = parseProjectSnapshot(p);
  buildProjectConnectivityIndex(owned, resolver);
  const doc = owned.documents[0]!,
    plan = planRoutingDeletion(
      doc,
      resolver,
      { instanceIds: [], junctionIds: [], routeIds: ["ar2"] },
      1,
    );
  const oracle = gateRoutingOperationPlan(structuredClone(doc), plan, context);
  if (!oracle.ok) throw Error(oracle.message);
  const membership = vi.spyOn(phase, "prepareConnectivityPhaseRead");
  try {
    const gate = gateCanvasWireCommit(doc, plan, context);
    if (!gate.ok) throw Error(gate.message);
    const result = adoptPreparedCanvasTransaction(
      doc,
      gate.edits,
      gate.preparedTransaction,
      context,
    );
    if (!result.ok) throw Error(result.error.message);
    expect(result.diff).toEqual(oracle.evaluated.diff);
    expect(result.document).toEqual(oracle.evaluated.finalDocument);
    const net = (id: string) =>
      result.document.junctions.find((j) => j.id === id)?.netId;
    expect(net("left")).toBeTruthy();
    expect(net("right")).toBeTruthy();
    expect(net("left")).not.toEqual(net("right"));
    const visits = membership.mock.calls.flatMap(([rows]) =>
      rows.routes.map((r) => r.id),
    );
    expect(visits).toContain("left-wire");
    expect(visits).toContain("right-wire");
    expect(visits).not.toContain("unrelated0r1");
  } finally {
    membership.mockRestore();
  }
});

it("checks a simple wire locally beside a Global Net, a named Net, a bus, a child Cell and a PDK MOS", () => {
  const work = measure(8, 3, true, (p) => {
    const d = p.documents[0]!;
    d.connectivityEvidence.push(
      {
        id: "src",
        kind: "spice-source",
        netId: "unrelated0",
        sourceNetId: "VDD",
      },
      {
        id: "global",
        kind: "name-claim",
        netId: "unrelated0",
        name: "VDD",
        scope: "global",
        owner: { kind: "global-declaration", sourceNetId: "VDD" },
      },
    );
    d.annotations.push({
      id: "label",
      kind: "net-label",
      netId: "unrelated1",
      binding: { kind: "net-name", netId: "unrelated1" },
      anchor: {
        kind: "object",
        objectId: "unrelated1j0",
        localOffset: { x: 0, y: 0 },
        fallbackPosition: { x: 0, y: 1100 },
      },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    d.connectivityEvidence.push({
      id: "bias",
      kind: "name-claim",
      netId: "unrelated1",
      name: "bias",
      scope: "local",
      owner: { kind: "net-label", annotationId: "label" },
    });
    d.junctions.push({
      id: "trunk",
      netId: "unrelated2",
      position: { x: 400, y: 1000 },
      members: [
        { id: "low", netId: "unrelated2" },
        { id: "high", netId: "unrelated3" },
      ],
    });
    const child = createEmptyDocument("child", "Child");
    p.documents.push(child);
    d.instances.push({
      id: "call",
      reference: "X1",
      symbolId: "resistor",
      placement: null,
      netlist: {
        binding: { kind: "subcircuit", childDocumentId: "child" },
        parameters: {},
      },
    });
    addPdkMos(p);
    d.nets
      .find((n) => n.id === "unrelated4")!
      .terminals.push({ instanceId: "M1", pinName: "G" });
  });
  expect(work.checked).not.toContain("unrelated0r1");
  expect(work.phaseRoutes).not.toContain("unrelated7r1");
});

function addPdkMos(p: ReturnType<typeof drawing>) {
  p.externalSubcircuitDefinitions.push({
    id: "pfet",
    name: "sky130_fd_pr__pfet_01v8",
    terminals: ["D", "G", "S", "B"].map((name) => ({
      name,
      id: name,
      direction: "passive",
    })),
    formalParameters: [],
    interfaceStatus: "declared",
  });
  p.documents[0]!.instances.push({
    id: "M1",
    reference: "M1",
    symbolId: "pmos",
    placement: { position: { x: 160, y: 60 }, rotation: 0, mirror: "none" },
    netlist: {
      binding: { kind: "external-subcircuit", definitionId: "pfet" },
      parameters: {},
    },
  });
}

it.each(["G", "D", "S"])(
  "checks only affected Routes when wiring a declared PDK MOS %s pin",
  (pinName) => {
    const work = measure(
      12,
      3,
      true,
      (p) => {
        addPdkMos(p);
        p.documents[0]!.nets.find((n) => n.id === "b")!.terminals.push({
          instanceId: "M1",
          pinName,
        });
      },
      { kind: "terminal", instanceId: "M1", pinName },
    );
    expect(work.checked).not.toContain("unrelated0r1");
    expect(work.phaseRoutes).not.toContain("unrelated0r1");
  },
);

it("rebuilds the actual Net when a batch draws and cuts the same temporary bridge", () => {
  const project = drawing(3, 3),
    source = project.documents[0]!;
  source.routes = source.routes.filter((r) => r.id !== "ar2");
  const owned = parseProjectSnapshot(project),
    doc = owned.documents[0]!;
  buildProjectConnectivityIndex(owned, resolver);
  const route = createRoutePath({
    id: "bridge",
    netId: "a",
    start: junction("aj1"),
    end: junction("aj2"),
    bends: [],
    modes: ["manual"],
  });
  const transaction = {
    documentId: doc.id,
    transactionId: "bridge-cut",
    expectedRevision: doc.revision,
    actor: { kind: "agent", id: "test" },
    edits: [
      { kind: "set_route_path", route },
      { kind: "cut_connection", routeId: route.id },
    ],
  };
  const oracle = executeTransaction(structuredClone(doc), transaction, context);
  const actual = executeTransaction(doc, transaction, context);
  expect(actual).toEqual(oracle);
  if (!actual.ok) throw Error(actual.error.message);
  const netAt = (id: string) =>
    actual.document.junctions.find((j) => j.id === id)?.netId;
  expect(netAt("aj1")).not.toEqual(netAt("aj2"));
});

it("does not revisit unrelated bus conductors to write a scalar Net partition", () => {
  function memberVisits(bypass: boolean) {
    const project = drawing(0, 4),
      d = project.documents[0]!;
    if (bypass)
      d.routes.push(
        createRoutePath({
          id: "bypass",
          netId: "a",
          start: junction("aj1"),
          end: junction("aj2"),
          bends: [
            { x: 20, y: 30 },
            { x: 40, y: 30 },
          ],
          modes: ["manual", "manual", "manual"],
        }),
      );
    for (let i = 0; i < 24; i++) {
      const members = Array.from({ length: 8 }, (_, lane) => ({
        id: "m" + lane,
        netId: "bus" + i + "-" + lane,
      }));
      for (const m of members) d.nets.push({ id: m.netId, terminals: [] });
      const netId = members[0]!.netId;
      for (const [side, x] of [
        ["l", 0],
        ["r", 40],
      ] as const)
        d.junctions.push({
          id: side + i,
          netId,
          position: { x, y: 1000 + i * 20 },
          members,
        });
      const route = createRoutePath({
        id: "trunk" + i,
        netId,
        start: junction("l" + i),
        end: junction("r" + i),
        bends: [],
        modes: ["manual"],
      });
      route.members = members.map((m) => ({
        ...m,
        startMemberId: m.id,
        endMemberId: m.id,
      }));
      d.routes.push(route);
    }
    const owned = parseProjectSnapshot(project),
      doc = owned.documents[0]!;
    buildProjectConnectivityIndex(owned, resolver);
    const plan = planRoutingDeletion(
      doc,
      resolver,
      { instanceIds: [], routeIds: ["ar2"], junctionIds: [] },
      1,
    );
    const oracle = gateRoutingOperationPlan(
      structuredClone(doc),
      plan,
      context,
    );
    if (!oracle.ok) throw Error(oracle.message);
    const conductors = vi.spyOn(model, "routeElectricalConnections");
    try {
      const gate = gateCanvasWireCommit(doc, plan, context);
      if (!gate.ok) throw Error(gate.message);
      const result = adoptPreparedCanvasTransaction(
        doc,
        gate.edits,
        gate.preparedTransaction,
        context,
      );
      if (!result.ok) throw Error(result.error.message);
      expect(result.document).toEqual(oracle.evaluated.finalDocument);
      expect(result.diff).toEqual(oracle.evaluated.diff);
      return conductors.mock.calls.filter(([r]) => r.id.startsWith("trunk"))
        .length;
    } finally {
      conductors.mockRestore();
    }
  }
  expect(memberVisits(false)).toEqual(memberVisits(true));
});
