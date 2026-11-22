import { expect, it } from "vitest";
import {
  CircuitProjectSchema,
  createEmptyProject,
  createEmptyDocument,
  createRoutePath,
} from "@icm/model";
import { analyzeDesignNetlist } from "@icm/netlist";
import {
  createBlockSymbol,
  hierarchicalSymbolId,
  createProjectSymbolResolver,
  builtInSymbols,
} from "@icm/symbols";
import { parseProject, serializeProject } from "@icm/project-protocol";
import {
  executeProjectTransaction,
  type ProjectStructureEdit,
} from "./project-transaction.js";
import { planCreateCellPin } from "./cell-pin-planner.js";
import {
  planRenameCellTerminal,
  planSetCellTerminalSignal,
} from "./cell-interface-change-planner.js";
import { proposeWireIntent } from "./wire-intent-planner.js";
import { planEnsureNamedRoute } from "./signal-wire-planner.js";
import {
  createFreeWireAnchor,
  createRouteWireAnchor,
  proposeWireCommit,
} from "./wire-commit-planner.js";
import { planNameSignalRoute } from "./signal-wire.test-support.js";
import {
  resolveDocumentLogicalNets,
  resolveElectricalContactTargets,
} from "@icm/derived";
import {
  createRoutingOperationPlan,
  gateRoutingOperationPlan,
} from "./routing-operation-plan.js";

it.each(["IN", "DATA<2>"])(
  "renames a connected explicit scalar Cell Pin %s without changing its connection",
  (name) => {
    let project = createEmptyProject("scalar-rename", "Scalar rename", "child");
    const apply = (edits: ProjectStructureEdit[]) => {
      const result = executeProjectTransaction(project, {
        transactionId: `edit-${project.structureRevision}`,
        projectId: project.id,
        expectedStructureRevision: project.structureRevision,
        actor: { kind: "human", id: "test" },
        edits,
      });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      project = result.project;
    };
    apply(
      planCreateCellPin(project, "child", {
        instance: {
          id: "port",
          symbolId: "port",
          placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
        },
        terminal: {
          id: "formal",
          name,
          netId: "input",
          direction: "input",
          interfaceInstanceIds: ["port"],
        },
        signalExpression: name,
        connectionEdits: [],
      }),
    );
    const document = project.documents[0]!;
    const wire = proposeWireIntent(
      document,
      createProjectSymbolResolver(project, builtInSymbols),
      {
        id: "wire",
        from: {
          kind: "endpoint",
          endpoint: { kind: "terminal", instanceId: "port", pinName: "P" },
        },
        to: { kind: "free", point: { x: 100, y: 0 } },
      },
    );
    if (typeof wire === "string") throw new Error(wire);
    apply([
      {
        kind: "transact_document",
        documentId: "child",
        expectedRevision: document.revision,
        edits: wire.edits,
      },
    ]);
    const before = project.documents[0]!;
    const member = before.netlist!.terminals[0]!.signal!.members[0]!;
    apply(planRenameCellTerminal(project, "child", "formal", "RENAMED"));
    const reopened = parseProject(serializeProject(project)).documents[0]!;
    expect(reopened.routes).toEqual(before.routes);
    expect(reopened.nets).toEqual(before.nets);
    expect(reopened.netlist!.terminals[0]!.signal).toEqual({
      expression: "RENAMED",
      members: [{ ...member, name: "RENAMED" }],
    });
  },
);

it("authors one aggregate Cell Pin with four ordered independent formal members", () => {
  const project = createEmptyProject("bus-project", "Bus", "child");
  const edits = planCreateCellPin(project, "child", {
    instance: {
      id: "input-pin",
      symbolId: "port",
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    },
    terminal: {
      id: "input",
      name: "IN<3:0>",
      netId: "input-net",
      direction: "input",
      interfaceInstanceIds: ["input-pin"],
    },
    connectionEdits: [],
    signalExpression: "IN<3:0>",
  });
  const result = executeProjectTransaction(project, {
    transactionId: "create-vector",
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    actor: { kind: "human", id: "test" },
    edits,
  });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) return;
  const child = result.project.documents[0]!;
  expect(child.nets).toHaveLength(4);
  expect(new Set(child.nets.map((net) => net.id)).size).toBe(4);
  const symbol = createBlockSymbol({
    id: "child-symbol",
    name: "child",
    terminals: child.netlist!.terminals,
  });
  expect(symbol.pins.map((pin) => pin.name)).toEqual(["IN<3:0>"]);
  const netlist = analyzeDesignNetlist(result.project);
  expect(netlist.ir?.cells[0]?.ports.map((pin) => pin.name)).toEqual([
    "IN_3_",
    "IN_2_",
    "IN_1_",
    "IN_0_",
  ]);
  const reopened = parseProject(serializeProject(result.project));
  expect(reopened.documents[0]!.nets).toEqual(child.nets);
  expect(analyzeDesignNetlist(reopened).ir).toEqual(netlist.ir);
  const members = child.netlist!.terminals[0]!.signal!.members;
  const endpoint = {
    kind: "terminal" as const,
    instanceId: "input-pin",
    pinName: "P",
  };
  const proposal = proposeWireCommit(
    {
      endpoint,
      netId: members[0]!.netId,
      preludeEdits: [],
      members,
      connection: {
        endpoint,
        contactPoint: { x: 0, y: 0 },
        gridLanding: { x: 0, y: 0 },
        escapePath: [],
        outward: null,
      },
    },
    createFreeWireAnchor(
      { x: 100, y: 0 },
      members[0]!.netId,
      false,
      "trunk-end",
    ),
    [],
    { routeId: "trunk", newNetId: "unused" },
  );
  const gate = gateRoutingOperationPlan(
    child,
    createRoutingOperationPlan(child, {
      intent: "connect",
      edits: proposal.edits,
      diagnostics: [],
    }),
    {
      symbolResolver: createProjectSymbolResolver(
        result.project,
        builtInSymbols,
      ),
    },
  );
  expect(gate.ok, JSON.stringify(gate)).toBe(true);
  let drawn = executeProjectTransaction(result.project, {
    transactionId: "trunk",
    projectId: project.id,
    expectedStructureRevision: result.project.structureRevision,
    actor: { kind: "human", id: "test" },
    edits: [
      {
        kind: "transact_document",
        documentId: child.id,
        expectedRevision: child.revision,
        edits: proposal.edits,
      },
    ],
  });
  expect(drawn.ok, JSON.stringify(drawn)).toBe(true);
  if (!drawn.ok) return;
  expect(drawn.project.documents[0]!.routes[0]!.members).toHaveLength(4);
  expect(drawn.project.documents[0]!.nets).toHaveLength(4);
  const removed = executeProjectTransaction(drawn.project, {
    transactionId: "remove-trunk",
    projectId: project.id,
    expectedStructureRevision: drawn.project.structureRevision,
    actor: { kind: "human", id: "test" },
    edits: [
      {
        kind: "transact_document",
        documentId: child.id,
        expectedRevision: drawn.project.documents[0]!.revision,
        edits: [{ kind: "cut_connection", routeId: "trunk" }],
      },
    ],
  });
  expect(removed.ok, JSON.stringify(removed)).toBe(true);
  if (removed.ok) {
    expect(removed.project.documents[0]!.routes).toEqual([]);
    expect(removed.project.documents[0]!.junctions).toEqual([]);
    expect(removed.project.documents[0]!.nets).toHaveLength(4);
  }
  expect(
    resolveElectricalContactTargets(
      drawn.project.documents[0]!,
      createProjectSymbolResolver(drawn.project, builtInSymbols),
      [
        {
          kind: "endpoint",
          id: "pin-hit",
          point: { x: 0, y: 0 },
          netId: null,
          endpoint,
        },
        {
          kind: "route",
          id: "route-hit",
          point: { x: 0, y: 0 },
          netId: members[0]!.netId,
          routeId: "trunk",
          segmentIndex: 0,
        },
      ],
    ),
  ).toHaveLength(1);
  const named = executeProjectTransaction(drawn.project, {
    transactionId: "name-trunk",
    projectId: project.id,
    expectedStructureRevision: drawn.project.structureRevision,
    actor: { kind: "human", id: "test" },
    edits: planNameSignalRoute(
      drawn.project,
      child.id,
      "trunk",
      "IN<3:0>",
      "trunk-label",
    ),
  });
  expect(named.ok, JSON.stringify(named)).toBe(true);
  if (!named.ok) return;
  drawn = named;
  expect(
    resolveDocumentLogicalNets(drawn.project.documents[0]!)
      .groups.map((net) => net.name)
      .sort(),
  ).toEqual(["IN<0>", "IN<1>", "IN<2>", "IN<3>"]);
  const drawnCell = drawn.project.documents[0]!;
  const tapEndpoint = {
    kind: "junction" as const,
    junctionId: "trunk-end",
    memberId: members[1]!.id,
  };
  const branch = proposeWireCommit(
    {
      endpoint: tapEndpoint,
      netId: members[1]!.netId,
      preludeEdits: [],
      connection: {
        endpoint: tapEndpoint,
        contactPoint: { x: 100, y: 0 },
        gridLanding: { x: 100, y: 0 },
        escapePath: [],
        outward: null,
      },
    },
    createFreeWireAnchor(
      { x: 100, y: 100 },
      members[1]!.netId,
      false,
      "branch-end",
    ),
    [],
    { routeId: "tap", newNetId: "unused" },
  );
  const tapped = executeProjectTransaction(drawn.project, {
    transactionId: "tap",
    projectId: project.id,
    expectedStructureRevision: drawn.project.structureRevision,
    actor: { kind: "human", id: "test" },
    edits: [
      {
        kind: "transact_document",
        documentId: child.id,
        expectedRevision: drawnCell.revision,
        edits: branch.edits,
      },
    ],
  });
  expect(tapped.ok, JSON.stringify(tapped)).toBe(true);
  if (!tapped.ok) return;
  expect(tapped.project.documents[0]!.nets).toHaveLength(4);
  expect(
    tapped.project.documents[0]!.routes.find((route) => route.id === "tap")
      ?.netId,
  ).toBe(members[1]!.netId);
  expect(tapped.project.documents[0]!.annotations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        binding: {
          kind: "net-name",
          netId: members[1]!.netId,
          memberEndpoint: tapEndpoint,
        },
      }),
    ]),
  );
  const tappedCell = tapped.project.documents[0]!;
  expect(
    resolveElectricalContactTargets(
      tappedCell,
      createProjectSymbolResolver(tapped.project, builtInSymbols),
      [
        {
          kind: "endpoint",
          id: "junction-hit",
          point: { x: 100, y: 0 },
          netId: null,
          endpoint: { kind: "junction", junctionId: "trunk-end" },
        },
        ...["trunk", "tap"].map((routeId) => ({
          kind: "route" as const,
          id: `${routeId}-hit`,
          point: { x: 100, y: 0 },
          netId: tappedCell.routes.find((route) => route.id === routeId)!.netId,
          routeId,
          segmentIndex: 0,
        })),
      ],
    ),
  ).toHaveLength(1);
  const anchor = createRouteWireAnchor(
    tappedCell,
    tappedCell.routes.find((route) => route.id === "trunk")!,
    { x: 50, y: 0 },
    0,
    10,
    {
      junctionId: "interior",
      firstRouteId: "trunk-left",
      secondRouteId: "trunk-right",
    },
    createProjectSymbolResolver(tapped.project, builtInSymbols),
  );
  const { members: selectable, ...scalarAnchor } = anchor;
  const selected = selectable![2]!;
  const interiorBranch = proposeWireCommit(
    {
      ...scalarAnchor,
      endpoint: { ...anchor.endpoint, memberId: selected.id },
      netId: selected.netId,
    },
    createFreeWireAnchor(
      { x: 50, y: -100 },
      selected.netId,
      false,
      "interior-end",
    ),
    [],
    { routeId: "interior-tap", newNetId: "unused" },
  );
  const interior = executeProjectTransaction(tapped.project, {
    transactionId: "interior-tap",
    projectId: project.id,
    expectedStructureRevision: tapped.project.structureRevision,
    actor: { kind: "human", id: "test" },
    edits: [
      {
        kind: "transact_document",
        documentId: child.id,
        expectedRevision: tappedCell.revision,
        edits: interiorBranch.edits,
      },
    ],
  });
  expect(interior.ok, JSON.stringify(interior)).toBe(true);
  if (!interior.ok) return;
  expect(
    interior.project.documents[0]!.routes.filter((route) => route.members),
  ).toHaveLength(2);
  expect(interior.project.documents[0]!.nets).toHaveLength(4);
  const cut = executeProjectTransaction(interior.project, {
    transactionId: "cut-tap",
    projectId: project.id,
    expectedStructureRevision: interior.project.structureRevision,
    actor: { kind: "human", id: "test" },
    edits: [
      {
        kind: "transact_document",
        documentId: child.id,
        expectedRevision: interior.project.documents[0]!.revision,
        edits: [{ kind: "cut_connection", routeId: "interior-tap" }],
      },
    ],
  });
  expect(cut.ok, JSON.stringify(cut)).toBe(true);
  if (!cut.ok) return;
  expect(
    cut.project.documents[0]!.routes.filter((route) => route.members),
  ).toHaveLength(2);
  expect(
    cut.project.documents[0]!.annotations.some(
      (annotation) => annotation.id === "interior-tap-selector",
    ),
  ).toBe(false);
});

it("edits a newly authored scalar Cell Pin to a vector before it is connected", () => {
  const project = createEmptyProject("edit-signal", "Edit signal", "child");
  const created = executeProjectTransaction(project, {
    transactionId: "scalar",
    projectId: project.id,
    expectedStructureRevision: 0,
    actor: { kind: "human", id: "test" },
    edits: planCreateCellPin(project, "child", {
      instance: {
        id: "pin",
        symbolId: "port",
        placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      },
      terminal: {
        id: "terminal",
        name: "IN",
        netId: "net",
        direction: "input",
        interfaceInstanceIds: ["pin"],
      },
      connectionEdits: [
        {
          kind: "connect_endpoints",
          from: { kind: "terminal", instanceId: "pin", pinName: "P" },
          to: { kind: "terminal", instanceId: "pin", pinName: "P" },
          newNetId: "net",
        },
      ],
      signalExpression: "IN",
    }),
  });
  expect(created.ok, JSON.stringify(created)).toBe(true);
  if (!created.ok) return;
  const result = executeProjectTransaction(created.project, {
    transactionId: "vector",
    projectId: project.id,
    expectedStructureRevision: created.project.structureRevision,
    actor: { kind: "human", id: "test" },
    edits: planSetCellTerminalSignal(
      created.project,
      "child",
      "terminal",
      "IN<0:3>",
    ),
  });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) return;
  expect(
    analyzeDesignNetlist(result.project).ir?.cells[0]?.ports.map(
      (port) => port.name,
    ),
  ).toEqual(["IN_0_", "IN_1_", "IN_2_", "IN_3_"]);
});

it("a whole-bus route maps four scalar members in explicit order without joining lanes", () => {
  let project = createEmptyProject("mapping", "Mapping", "child");
  for (const [id, name, x] of [
    ["in", "IN<3:0>", 0],
    ["out", "OUT<0:3>", 100],
  ] as const) {
    const result = executeProjectTransaction(project, {
      transactionId: id,
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: planCreateCellPin(project, "child", {
        instance: {
          id,
          symbolId: "port",
          placement: { position: { x, y: 0 }, rotation: 0, mirror: "none" },
        },
        terminal: {
          id: `${id}-terminal`,
          name,
          netId: `${id}-net`,
          direction: "passive",
          interfaceInstanceIds: [id],
        },
        connectionEdits: [],
        signalExpression: name,
      }),
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    project = result.project;
  }
  const before = project.documents[0]!;
  const inputs = before.netlist!.terminals[0]!.signal!.members;
  const outputs = before.netlist!.terminals[1]!.signal!.members;
  const route = createRoutePath({
    id: "bus",
    netId: inputs[0]!.netId,
    start: { kind: "terminal", instanceId: "in", pinName: "P" },
    end: { kind: "terminal", instanceId: "out", pinName: "P" },
    bends: [],
    modes: ["manual"],
    members: inputs.map((member, index) => ({
      id: `lane-${index}`,
      netId: member.netId,
      startMemberId: member.id,
      endMemberId: outputs[index]!.id,
    })),
  });
  const result = executeProjectTransaction(project, {
    transactionId: "wire",
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    actor: { kind: "human", id: "test" },
    edits: [
      {
        kind: "transact_document",
        documentId: before.id,
        expectedRevision: before.revision,
        edits: [{ kind: "set_route_path", route }],
      },
    ],
  });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) return;
  const cell = result.project.documents[0]!;
  expect(cell.nets).toHaveLength(4);
  for (let index = 0; index < 4; index++) {
    expect(
      cell.nets
        .find((net) =>
          net.terminals.some(
            (terminal) => terminal.memberId === inputs[index]!.id,
          ),
        )
        ?.terminals.map((terminal) => terminal.memberId)
        .sort(),
    ).toEqual([inputs[index]!.id, outputs[index]!.id].sort());
  }
  const invalidRoute = structuredClone(cell.routes[0]!);
  invalidRoute.members![0]!.endMemberId = "missing-member";
  const refused = executeProjectTransaction(result.project, {
    transactionId: "bad-member",
    projectId: project.id,
    expectedStructureRevision: result.project.structureRevision,
    actor: { kind: "agent", id: "test" },
    edits: [
      {
        kind: "transact_document",
        documentId: cell.id,
        expectedRevision: cell.revision,
        edits: [{ kind: "set_route_path", route: invalidRoute }],
      },
    ],
  });
  expect(refused.ok).toBe(false);
  expect(refused.project).toEqual(result.project);
  const parent = createEmptyDocument("parent", "parent");
  parent.instances.push({
    id: "call",
    reference: "X1",
    symbolId: hierarchicalSymbolId(cell.netlist!.name),
    placement: null,
    netlist: {
      binding: { kind: "subcircuit", childDocumentId: cell.id },
      parameters: {},
    },
  });
  const hierarchy = {
    ...project,
    topDocumentId: parent.id,
    documents: [...project.documents, parent],
  };
  const connected = executeProjectTransaction(hierarchy, {
    transactionId: "caller",
    projectId: hierarchy.id,
    expectedStructureRevision: hierarchy.structureRevision,
    actor: { kind: "human", id: "test" },
    edits: [
      {
        kind: "transact_document",
        documentId: parent.id,
        expectedRevision: parent.revision,
        edits: inputs.flatMap((member, index) => {
          const from = {
            kind: "terminal" as const,
            instanceId: "call",
            pinName: "IN<3:0>",
            memberId: member.id,
          };
          const to = {
            kind: "terminal" as const,
            instanceId: "call",
            pinName: "OUT<0:3>",
            memberId: outputs[index]!.id,
          };
          return [
            {
              kind: "connect_endpoints" as const,
              from,
              to,
              newNetId: `parent-bit-${index}`,
            },
          ];
        }),
      },
    ],
  });
  expect(connected.ok, JSON.stringify(connected)).toBe(true);
  if (!connected.ok) return;
  const analysis = analyzeDesignNetlist(connected.project);
  const caller = analysis.ir?.cells.find((item) => item.id === parent.id)
    ?.instances[0];
  expect(caller?.nodes.map((node) => node.pinName)).toEqual([
    "IN<3>",
    "IN<2>",
    "IN<1>",
    "IN<0>",
    "OUT<0>",
    "OUT<1>",
    "OUT<2>",
    "OUT<3>",
  ]);
  expect(new Set(caller?.nodes.map((node) => node.netName)).size).toBe(4);
});

it("establishes loose conductor width from a Label and refuses incompatible renames atomically", () => {
  const project = createEmptyProject("loose", "Loose bus", "cell");
  const wire = proposeWireCommit(
    createFreeWireAnchor({ x: 0, y: 0 }, "loose-net", true, "a"),
    createFreeWireAnchor({ x: 100, y: 0 }, "loose-net", false, "b"),
    [],
    { routeId: "loose-route", newNetId: "loose-net" },
  );
  const drawn = executeProjectTransaction(project, {
    transactionId: "wire",
    projectId: project.id,
    expectedStructureRevision: 0,
    actor: { kind: "human", id: "test" },
    edits: [
      {
        kind: "transact_document",
        documentId: "cell",
        expectedRevision: 0,
        edits: wire.edits,
      },
    ],
  });
  expect(drawn.ok, JSON.stringify(drawn)).toBe(true);
  if (!drawn.ok) return;
  for (const name of ["A,,B", "DATA[3:0]", "DATA:3", "X".repeat(257)]) {
    const document = drawn.project.documents[0]!;
    const before = structuredClone(document);
    const invalid = planEnsureNamedRoute(document, "loose-route", {
      name,
      candidateNetId: "loose-net",
      evidenceId: "invalid-name",
      owner: { kind: "net-label", annotationId: "invalid" },
    });
    expect(invalid.ok, name).toBe(false);
    expect(document).toEqual(before);
  }
  const named = executeProjectTransaction(drawn.project, {
    transactionId: "name",
    projectId: project.id,
    expectedStructureRevision: drawn.project.structureRevision,
    actor: { kind: "human", id: "test" },
    edits: planNameSignalRoute(
      drawn.project,
      "cell",
      "loose-route",
      "DATA<7:4>",
      "label",
    ),
  });
  expect(named.ok, JSON.stringify(named)).toBe(true);
  if (!named.ok) return;
  const cell = named.project.documents[0]!;
  expect(cell.routes[0]!.members).toHaveLength(4);
  expect(cell.nets).toHaveLength(4);
  expect(
    resolveDocumentLogicalNets(cell)
      .groups.map((net) => net.name)
      .sort(),
  ).toEqual(["DATA<4>", "DATA<5>", "DATA<6>", "DATA<7>"]);
  expect(() =>
    planNameSignalRoute(
      named.project,
      "cell",
      "loose-route",
      "DATA<3:0>",
      "label",
    ),
  ).toThrow(/migration/u);
  expect(
    planNameSignalRoute(
      named.project,
      "cell",
      "loose-route",
      "DATA<7:4>",
      "label",
    ),
  ).toEqual([]);
  const corrupted = structuredClone(named.project);
  const claim = corrupted.documents[0]!.connectivityEvidence.find(
    (evidence) => evidence.kind === "name-claim",
  )!;
  if (claim.kind !== "name-claim" || !claim.signal)
    throw new Error("Missing bus declaration");
  const [first, second] = claim.signal.members;
  [first!.netId, second!.netId] = [second!.netId, first!.netId];
  claim.netId = first!.netId;
  expect(CircuitProjectSchema.safeParse(corrupted).success).toBe(false);
  const renamedClaim = structuredClone(
    cell.connectivityEvidence.find(
      (evidence) => evidence.kind === "name-claim",
    )!,
  );
  if (renamedClaim.kind !== "name-claim" || !renamedClaim.signal)
    throw new Error("Missing bus declaration");
  renamedClaim.name = renamedClaim.signal.expression = "OTHER<7:4>";
  for (const member of renamedClaim.signal.members)
    member.name = member.name.replace("DATA", "OTHER");
  const refused = executeProjectTransaction(named.project, {
    transactionId: "rename",
    projectId: project.id,
    expectedStructureRevision: named.project.structureRevision,
    actor: { kind: "agent", id: "test" },
    edits: [
      {
        kind: "transact_document",
        documentId: cell.id,
        expectedRevision: cell.revision,
        edits: [
          { kind: "upsert_connectivity_evidence", evidence: renamedClaim },
        ],
      },
    ],
  });
  expect(refused.ok).toBe(false);
  expect(refused.project).toEqual(named.project);
});
