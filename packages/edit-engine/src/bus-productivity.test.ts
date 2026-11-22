import { expect, it } from "vitest";
import {
  createEmptyDocument,
  createEmptyProject,
  roleLabelFormat,
  type CircuitProject,
} from "@icm/model";
import { parseProject, serializeProject } from "@icm/project-protocol";
import { hierarchicalSymbolId } from "@icm/symbols";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { planExpandedNetLabels } from "./expanded-label-planner.js";
import { planSetNoConnect } from "./no-connect-planner.js";
import { planRenameCellTerminal } from "./cell-interface-change-planner.js";
import {
  buildProjectConnectivityIndex,
  runErcChecks,
  resolveEndpointConnection,
} from "@icm/derived";
import { proposeWireIntent } from "./wire-intent-planner.js";
import { planDisconnectPinMember } from "./no-connect-planner.js";
import { planCreateCellPin } from "./cell-pin-planner.js";
import {
  executeProjectTransaction,
  type ProjectStructureEdit,
} from "./project-transaction.js";

function transact(project: CircuitProject, edits: ProjectStructureEdit[]) {
  return executeProjectTransaction(project, {
    transactionId: `productivity-${project.structureRevision}`,
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    actor: { kind: "human", id: "test" },
    edits,
  });
}
function apply(project: CircuitProject, edits: ProjectStructureEdit[]) {
  const result = transact(project, edits);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.project;
}
function fixture() {
  let project = createEmptyProject("productivity", "Productivity", "child");
  project = apply(
    project,
    planCreateCellPin(project, "child", {
      instance: {
        id: "port",
        symbolId: "port",
        placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      },
      terminal: {
        id: "formal",
        name: "DATA<3:0>",
        netId: "input",
        direction: "input",
        interfaceInstanceIds: ["port"],
      },
      signalExpression: "DATA<3:0>",
      connectionEdits: [],
    }),
  );
  const parent = createEmptyDocument("parent", "Parent");
  parent.instances.push({
    id: "caller",
    symbolId: hierarchicalSymbolId(project.documents[0]!.netlist!.name),
    reference: "X1",
    placement: { position: { x: 200, y: 0 }, rotation: 0, mirror: "none" },
    netlist: {
      binding: { kind: "subcircuit", childDocumentId: "child" },
      parameters: {},
    },
  });
  return apply(project, [{ kind: "add_document", document: parent }]);
}

it("marks only requested open bus members, rejects connected or unknown members atomically, and reopens", () => {
  const source = fixture();
  const members = source.documents[0]!.netlist!.terminals[0]!.signal!.members;
  const endpoint = (memberId: string) => ({
    kind: "terminal" as const,
    instanceId: "caller",
    pinName: "DATA<3:0>",
    memberId,
  });
  const marked = apply(source, [
    {
      kind: "transact_document",
      documentId: "parent",
      expectedRevision: 0,
      edits: [
        {
          kind: "add_no_connect",
          noConnect: { id: "nc-3", endpoint: endpoint(members[0]!.id) },
        },
        {
          kind: "add_no_connect",
          noConnect: { id: "nc-1", endpoint: endpoint(members[2]!.id) },
        },
      ],
    },
  ]);
  expect(
    marked.documents[1]!.noConnects.map((item) => item.endpoint.memberId),
  ).toEqual([members[0]!.id, members[2]!.id]);
  expect(marked.documents[1]!.nets).toEqual([]);
  const saved = serializeProject(marked);
  const reopened = parseProject(saved);
  expect(serializeProject(reopened)).toBe(saved);
  const bad = transact(marked, [
    {
      kind: "transact_document",
      documentId: "parent",
      expectedRevision: marked.documents[1]!.revision,
      edits: [
        { kind: "remove_no_connect", noConnectId: "nc-3" },
        {
          kind: "add_no_connect",
          noConnect: { id: "nc-bad", endpoint: endpoint("missing") },
        },
      ],
    },
  ]);
  expect(bad.ok).toBe(false);
  const connected = apply(marked, [
    {
      kind: "transact_document",
      documentId: "parent",
      expectedRevision: marked.documents[1]!.revision,
      edits: [
        {
          kind: "add_junction",
          junctionId: "contact",
          netId: "connected",
          createNet: true,
          position: { x: 400, y: 0 },
        },
        {
          kind: "connect_endpoints",
          from: endpoint(members[1]!.id),
          to: { kind: "junction", junctionId: "contact" },
        },
      ],
    },
  ]);
  const parent = connected.documents[1]!;
  expect(parent.noConnects).toHaveLength(2);
  const resolver = createProjectSymbolResolver(connected, builtInSymbols);
  expect(() =>
    planSetNoConnect(parent, resolver, [endpoint(members[1]!.id)], true),
  ).toThrow("Disconnect");
  expect(() =>
    planSetNoConnect(
      parent,
      resolver,
      [{ kind: "terminal", instanceId: "caller", pinName: "DATA<3:0>" }],
      true,
    ),
  ).toThrow("explicit");
  const conflict = transact(connected, [
    {
      kind: "transact_document",
      documentId: "parent",
      expectedRevision: parent.revision,
      edits: [
        {
          kind: "add_no_connect",
          noConnect: { id: "conflict", endpoint: endpoint(members[1]!.id) },
        },
      ],
    },
  ]);
  expect(conflict.ok).toBe(false);
  const cleared = apply(connected, [
    {
      kind: "transact_document",
      documentId: "parent",
      expectedRevision: parent.revision,
      edits: planSetNoConnect(
        parent,
        resolver,
        [endpoint(members[0]!.id), endpoint(members[2]!.id)],
        false,
      ),
    },
  ]);
  expect(cleared.documents[1]!.noConnects).toEqual([]);
  expect(cleared.documents[1]!.nets).toEqual(parent.nets);
});

it("explicitly disconnects one wired member while retaining other lanes and then marks it unused", () => {
  let project = fixture();
  let parent = project.documents[1]!;
  let resolver = createProjectSymbolResolver(project, builtInSymbols);
  const wire = proposeWireIntent(parent, resolver, {
    id: "trunk",
    from: {
      kind: "endpoint",
      endpoint: {
        kind: "terminal",
        instanceId: "caller",
        pinName: "DATA<3:0>",
      },
    },
    to: { kind: "free", point: { x: 400, y: 0 } },
  });
  if (typeof wire === "string") throw new Error(wire);
  project = apply(project, [
    {
      kind: "transact_document",
      documentId: parent.id,
      expectedRevision: parent.revision,
      edits: wire.edits,
    },
  ]);
  parent = project.documents[1]!;
  resolver = createProjectSymbolResolver(project, builtInSymbols);
  const members = project.documents[0]!.netlist!.terminals[0]!.signal!.members;
  const endpoint = {
    kind: "terminal" as const,
    instanceId: "caller",
    pinName: "DATA<3:0>",
    memberId: members[1]!.id,
  };
  const disconnected = apply(project, [
    {
      kind: "transact_document",
      documentId: parent.id,
      expectedRevision: parent.revision,
      edits: planDisconnectPinMember(parent, resolver, endpoint),
    },
  ]);
  const after = disconnected.documents[1]!;
  expect(
    after.nets
      .flatMap((net) => net.terminals)
      .filter((item) => item.instanceId === "caller")
      .map((item) => item.memberId)
      .sort(),
  ).toEqual([members[0]!.id, members[2]!.id, members[3]!.id].sort());
  expect(
    after.routes.find((item) => item.id === wire.routeId)!.members,
  ).toHaveLength(4);
  const marked = apply(disconnected, [
    {
      kind: "transact_document",
      documentId: after.id,
      expectedRevision: after.revision,
      edits: planSetNoConnect(
        after,
        createProjectSymbolResolver(disconnected, builtInSymbols),
        [endpoint],
        true,
      ),
    },
  ]);
  expect(marked.documents[1]!.noConnects[0]!.endpoint).toEqual(endpoint);
});

it("reports missing members independently and follows No Connect identity through interface reorder", () => {
  let project = fixture();
  const members = project.documents[0]!.netlist!.terminals[0]!.signal!.members;
  project = apply(project, [
    {
      kind: "transact_document",
      documentId: "parent",
      expectedRevision: 0,
      edits: [
        {
          kind: "add_no_connect",
          noConnect: {
            id: "unused",
            endpoint: {
              kind: "terminal",
              instanceId: "caller",
              pinName: "DATA<3:0>",
              memberId: members[1]!.id,
            },
          },
        },
      ],
    },
  ]);
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  const diagnostics = runErcChecks(
    project,
    buildProjectConnectivityIndex(project, resolver),
    resolver,
  ).filter(
    (item) =>
      item.code === "ERC_UNCONNECTED_PIN" &&
      item.primary.documentId === "parent",
  );
  expect(diagnostics.map((item) => item.parameters.memberName).sort()).toEqual([
    "DATA<0>",
    "DATA<1>",
    "DATA<3>",
  ]);
  expect(diagnostics.every((item) => item.primary.endpoint?.memberId)).toBe(
    true,
  );
  const changed = apply(
    project,
    planRenameCellTerminal(project, "child", "formal", "DATA<0:3>"),
  );
  expect(changed.documents[1]!.noConnects).toEqual([
    {
      id: "unused",
      endpoint: {
        kind: "terminal",
        instanceId: "caller",
        pinName: "DATA<0:3>",
        memberId: members[1]!.id,
      },
    },
  ]);
});

it("retains a one-grid caller contact when disconnecting its selected member", () => {
  let project = fixture();
  let document = project.documents[1]!;
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  const member =
    project.documents[0]!.netlist!.terminals[0]!.signal!.members[0]!;
  const endpoint = {
    kind: "terminal" as const,
    instanceId: "caller",
    pinName: "DATA<3:0>",
    memberId: member.id,
  };
  const connection = resolveEndpointConnection(document, resolver, endpoint)!;
  const outward = connection.outward ?? { x: 1, y: 0 };
  const proposal = proposeWireIntent(document, resolver, {
    id: "short",
    from: { kind: "endpoint", endpoint },
    to: {
      kind: "free",
      point: {
        x: connection.gridLanding.x + outward.x * document.presentation.grid,
        y: connection.gridLanding.y + outward.y * document.presentation.grid,
      },
    },
  });
  if (typeof proposal === "string") throw new Error(proposal);
  project = apply(project, [
    {
      kind: "transact_document",
      documentId: document.id,
      expectedRevision: document.revision,
      edits: proposal.edits,
    },
  ]);
  document = project.documents[1]!;
  const result = apply(project, [
    {
      kind: "transact_document",
      documentId: document.id,
      expectedRevision: document.revision,
      edits: planDisconnectPinMember(
        document,
        createProjectSymbolResolver(project, builtInSymbols),
        endpoint,
      ),
    },
  ]);
  expect(
    result.documents[1]!.nets.some((net) =>
      net.terminals.some(
        (terminal) =>
          terminal.instanceId === "caller" && terminal.memberId === member.id,
      ),
    ),
  ).toBe(false);
});

it("expands an ordered expression onto explicit scalar branches in one public transaction", () => {
  let project = createEmptyProject("expanded", "Expanded Labels");
  for (let index = 0; index < 3; index++) {
    const document = project.documents[0]!;
    const proposal = proposeWireIntent(
      document,
      createProjectSymbolResolver(project, builtInSymbols),
      {
        id: `branch-${index}`,
        from: { kind: "free", point: { x: 0, y: index * 100 } },
        to: { kind: "free", point: { x: 200, y: index * 100 } },
      },
    );
    if (typeof proposal === "string") throw new Error(proposal);
    project = apply(project, [
      {
        kind: "transact_document",
        documentId: document.id,
        expectedRevision: document.revision,
        edits: proposal.edits,
      },
    ]);
  }
  const before = project.documents[0]!;
  const routeIds = [...before.routes].reverse().map((route) => route.id);
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  expect(() =>
    planExpandedNetLabels(before, resolver, "CLK,DATA<1:0>", routeIds.slice(1)),
  ).toThrow("3 distinct");
  const next = apply(project, [
    {
      kind: "transact_document",
      documentId: before.id,
      expectedRevision: before.revision,
      edits: planExpandedNetLabels(before, resolver, "CLK,DATA<1:0>", routeIds),
    },
  ]);
  const after = next.documents[0]!;
  expect(after.revision).toBe(before.revision + 1);
  expect(
    routeIds.map(
      (id) =>
        after.connectivityEvidence
          .filter((item) => item.kind === "name-claim")
          .find(
            (item) =>
              item.owner.kind === "net-label" &&
              item.owner.annotationId === `net-label-${id}`,
          )?.name,
    ),
  ).toEqual(["CLK", "DATA<1>", "DATA<0>"]);
  expect(after.routes).toEqual(before.routes);
  expect(serializeProject(parseProject(serializeProject(next)))).toBe(
    serializeProject(next),
  );
});

it("expanded Labels keep the normal voltage-node look when renamed", () => {
  let project = createEmptyProject("expanded-look", "Expanded look");
  const proposal = proposeWireIntent(
    project.documents[0]!,
    createProjectSymbolResolver(project, builtInSymbols),
    {
      id: "branch",
      from: { kind: "free", point: { x: 0, y: 0 } },
      to: { kind: "free", point: { x: 200, y: 0 } },
    },
  );
  if (typeof proposal === "string") throw new Error(proposal);
  for (const name of [null, "VIN", "VBP"]) {
    const document = project.documents[0]!;
    project = apply(project, [
      {
        kind: "transact_document",
        documentId: document.id,
        expectedRevision: document.revision,
        edits:
          name === null
            ? proposal.edits
            : planExpandedNetLabels(
                document,
                createProjectSymbolResolver(project, builtInSymbols),
                name,
                document.routes.map((route) => route.id),
              ),
      },
    ]);
    if (name !== null)
      expect(project.documents[0]!.annotations[0]!.formatOverride).toEqual(
        roleLabelFormat("voltage-node", name),
      );
  }
});
