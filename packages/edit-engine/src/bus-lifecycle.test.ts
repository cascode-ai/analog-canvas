import { expect, it } from "vitest";
import {
  createEmptyDocument,
  createEmptyProject,
  type CircuitProject,
} from "@icm/model";
import { parseProject, serializeProject } from "@icm/project-protocol";
import { analyzeDesignNetlist } from "@icm/netlist";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  hierarchicalSymbolId,
  createBlockSymbol,
} from "@icm/symbols";
import { proposeWireIntent } from "./wire-intent-planner.js";
import { planCreateCellPin } from "./cell-pin-planner.js";
import {
  planRenameCellTerminal,
  planSetCellTerminalSignal,
} from "./cell-interface-change-planner.js";
import {
  executeProjectTransaction,
  type ProjectStructureEdit,
} from "./project-transaction.js";

function apply(project: CircuitProject, edits: ProjectStructureEdit[]) {
  const result = executeProjectTransaction(project, {
    transactionId: `lifecycle-${project.structureRevision}`,
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    actor: { kind: "human", id: "test" },
    edits,
  });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.project;
}

function connectedBus() {
  let project = createEmptyProject("lifecycle", "Lifecycle", "child");
  project = apply(
    project,
    planCreateCellPin(project, "child", {
      instance: {
        id: "pin",
        symbolId: "port",
        placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      },
      terminal: {
        id: "formal",
        name: "IN<3:0>",
        netId: "input",
        direction: "input",
        interfaceInstanceIds: ["pin"],
      },
      signalExpression: "IN<3:0>",
      connectionEdits: [],
    }),
  );
  const before = project.documents[0]!.netlist!.terminals[0]!.signal!.members;
  project = apply(project, [
    {
      kind: "transact_document",
      documentId: "child",
      expectedRevision: project.documents[0]!.revision,
      edits: [
        {
          kind: "add_instance",
          instance: {
            id: "load",
            reference: "R1",
            symbolId: "resistor",
            placement: null,
            netlist: { parameters: { value: "1k" } },
          },
        },
        {
          kind: "connect_endpoints",
          from: {
            kind: "terminal",
            instanceId: "pin",
            pinName: "P",
            memberId: before[1]!.id,
          },
          to: { kind: "terminal", instanceId: "load", pinName: "1" },
          newNetId: before[1]!.netId,
        },
        {
          kind: "connect_endpoints",
          from: {
            kind: "terminal",
            instanceId: "pin",
            pinName: "P",
            memberId: before[0]!.id,
          },
          to: { kind: "terminal", instanceId: "load", pinName: "2" },
          newNetId: before[0]!.netId,
        },
      ],
    },
  ]);
  return { project, before };
}

it("reorders connected formal members by identity and survives a file round trip", () => {
  let { project, before } = connectedBus();
  project = apply(
    project,
    planRenameCellTerminal(project, "child", "formal", "IN<0,2,3,1>"),
  );
  const reopened = parseProject(serializeProject(project));
  const cell = reopened.documents[0]!;
  expect(
    cell.netlist!.terminals[0]!.signal!.members.map((member) => member.id),
  ).toEqual([before[3]!.id, before[1]!.id, before[0]!.id, before[2]!.id]);
  expect(
    cell.nets.find((net) =>
      net.terminals.some(
        (terminal) =>
          terminal.instanceId === "load" && terminal.pinName === "1",
      ),
    )!.id,
  ).toBe(before[1]!.netId);
  expect(
    analyzeDesignNetlist(reopened).ir?.cells[0]?.ports.map((port) => port.name),
  ).toEqual(["IN_0_", "IN_2_", "IN_3_", "IN_1_"]);
  const renamed = apply(
    reopened,
    planRenameCellTerminal(reopened, "child", "formal", "INPUT<3:0>", {
      memberMap: Object.fromEntries(
        before.map((member) => [member.id, member.name.replace("IN", "INPUT")]),
      ),
    }),
  );
  expect(renamed.documents[0]!.netlist!.terminals[0]!.signal!.members).toEqual(
    before.map((member) => ({
      ...member,
      name: member.name.replace("IN", "INPUT"),
    })),
  );
  expect(renamed.documents[0]!.nets).toEqual(reopened.documents[0]!.nets);
});

it("adds a fresh member after removal without reconnecting the old scalar load", () => {
  let { project, before } = connectedBus();
  project = apply(
    project,
    planRenameCellTerminal(project, "child", "formal", "IN<3,1,0>", {
      memberMap: { [before[1]!.id]: null },
    }),
  );
  project = apply(
    project,
    planRenameCellTerminal(project, "child", "formal", "IN<3:0>"),
  );
  const reopened = parseProject(serializeProject(project)).documents[0]!;
  const added = reopened.netlist!.terminals[0]!.signal!.members[1]!;
  expect(added.id).not.toBe(before[1]!.id);
  expect(added.netId).not.toBe(before[1]!.netId);
  expect(
    reopened.nets.find((net) => net.id === added.netId)!.terminals,
  ).toEqual([{ instanceId: "pin", pinName: "P", memberId: added.id }]);
  expect(
    reopened.nets.find((net) => net.id === before[1]!.netId)!.terminals,
  ).toEqual([{ instanceId: "load", pinName: "1" }]);
  project = apply(
    project,
    planRenameCellTerminal(project, "child", "formal", "IN<3,1,0>", {
      memberMap: { [added.id]: null },
    }),
  );
  project = apply(
    project,
    planRenameCellTerminal(project, "child", "formal", "IN<3:0>"),
  );
  expect(
    project.documents[0]!.netlist!.terminals[0]!.signal!.members[1]!.id,
  ).not.toBe(added.id);
});

it("retains a wired aggregate as editable stubs while bridging only surviving members", () => {
  let { project, before } = connectedBus();
  const cell = project.documents[0]!;
  const route = proposeWireIntent(
    cell,
    createProjectSymbolResolver(project, builtInSymbols),
    {
      id: "trunk",
      from: {
        kind: "endpoint",
        endpoint: { kind: "terminal", instanceId: "pin", pinName: "P" },
      },
      to: { kind: "free", point: { x: 100, y: 0 } },
    },
  );
  if (typeof route === "string") throw new Error(route);
  project = apply(project, [
    {
      kind: "transact_document",
      documentId: cell.id,
      expectedRevision: cell.revision,
      edits: route.edits,
    },
  ]);
  const oldRoute = project.documents[0]!.routes[0]!;
  for (const protection of ["leg", "group", "constraint"] as const) {
    const locked = structuredClone(project);
    const document = locked.documents[0]!;
    if (protection === "leg") document.routes[0]!.legs[0]!.mode = "locked";
    else if (protection === "group")
      document.layoutGroups.push({
        id: "lock",
        kind: "custom",
        locked: true,
        objectIds: [oldRoute.id],
      });
    else
      document.constraints.push({
        id: "lock",
        kind: "keep-clear",
        locked: true,
        objectIds: [oldRoute.id, "pin"],
      });
    const edits = planRenameCellTerminal(
      project,
      "child",
      "formal",
      "IN<3,1,0>",
      { memberMap: { [before[1]!.id]: null } },
    );
    const snapshot = serializeProject(locked);
    const result = executeProjectTransaction(locked, {
      transactionId: "protected-contact",
      projectId: locked.id,
      expectedStructureRevision: locked.structureRevision,
      actor: { kind: "human", id: "test" },
      edits,
    });
    expect(result.ok, protection).toBe(false);
    expect(serializeProject(locked)).toBe(snapshot);
    expect(() =>
      planRenameCellTerminal(locked, "child", "formal", "IN<3,1,0>", {
        memberMap: { [before[1]!.id]: null },
      }),
    ).toThrow(/locked|protected/i);
  }

  const reduced = apply(
    project,
    planRenameCellTerminal(project, "child", "formal", "IN<3,1,0>", {
      memberMap: { [before[1]!.id]: null },
    }),
  );
  const reopened = parseProject(serializeProject(reduced)).documents[0]!;
  const retained = reopened.routes.find((item) => item.id === oldRoute.id)!;
  expect(retained.members).toEqual(oldRoute.members);
  expect(retained.start.kind).toBe("junction");
  const bridge = reopened.routes.find(
    (item) => item.start.kind === "terminal" && item.start.instanceId === "pin",
  )!;
  expect(bridge.members!.map((member) => member.startMemberId)).toEqual([
    before[0]!.id,
    before[2]!.id,
    before[3]!.id,
  ]);
  expect(
    reopened.nets.find((net) => net.id === before[1]!.netId)!.terminals,
  ).toEqual([{ instanceId: "load", pinName: "1" }]);
});

it("resizes an unwired aggregate through the same explicit member transaction", () => {
  const { project, before } = connectedBus();
  const document = project.documents[0]!;
  document.instances = document.instances.filter(
    (instance) => instance.id !== "load",
  );
  for (const net of document.nets)
    net.terminals = net.terminals.filter(
      (terminal) => terminal.instanceId !== "load",
    );
  const reduced = apply(
    project,
    planRenameCellTerminal(project, "child", "formal", "IN<3,1,0>", {
      memberMap: { [before[1]!.id]: null },
    }),
  );
  expect(
    reduced.documents[0]!.netlist!.terminals[0]!.signal!.members.map(
      (member) => member.id,
    ),
  ).toEqual([before[0]!.id, before[2]!.id, before[3]!.id]);
});

it("requires explicit disconnection before removing a connected member", () => {
  const { project, before } = connectedBus();
  expect(() =>
    planRenameCellTerminal(project, "child", "formal", "IN<3,1,0>"),
  ).toThrow(/migration|mapping|disconnect/i);
  const reduced = apply(
    project,
    planRenameCellTerminal(project, "child", "formal", "IN<3,1,0>", {
      memberMap: { [before[1]!.id]: null },
    }),
  );
  const cell = parseProject(serializeProject(reduced)).documents[0]!;
  expect(
    cell.netlist!.terminals[0]!.signal!.members.map((member) => member.id),
  ).toEqual([before[0]!.id, before[2]!.id, before[3]!.id]);
  expect(
    cell.nets.find((net) => net.id === before[1]!.netId)!.terminals,
  ).toEqual([{ instanceId: "load", pinName: "1" }]);
  expect(project.documents[0]!.netlist!.terminals[0]!.signal!.members).toEqual(
    before,
  );
});

it("keeps authored label styling and visibility through a connected reduction", () => {
  let { project, before } = connectedBus();
  project = apply(project, [
    {
      kind: "transact_document",
      documentId: "child",
      expectedRevision: project.documents[0]!.revision,
      edits: [
        {
          kind: "upsert_schematic_annotation",
          annotation: {
            id: "formal-label",
            kind: "instance-label",
            binding: { kind: "cell-terminal-name", terminalId: "formal" },
            formatOverride: {
              runs: [
                {
                  kind: "span",
                  style: "bold",
                  children: [{ kind: "text", value: "IN<3:0>" }],
                },
              ],
            },
            anchor: {
              kind: "object",
              objectId: "pin",
              localOffset: { x: 10, y: -10 },
              fallbackPosition: { x: 10, y: -10 },
            },
            alignment: "start",
            rotation: 0,
            locked: false,
            visible: false,
          },
        },
      ],
    },
  ]);
  const locked = structuredClone(project);
  locked.documents[0]!.annotations[0]!.locked = true;
  const unchanged = serializeProject(locked);
  const edit = planRenameCellTerminal(project, "child", "formal", "IN<0:3>");
  const rejected = executeProjectTransaction(locked, {
    transactionId: "locked-formal",
    projectId: locked.id,
    expectedStructureRevision: locked.structureRevision,
    actor: { kind: "human", id: "test" },
    edits: edit,
  });
  expect(rejected.ok).toBe(false);
  expect(serializeProject(locked)).toBe(unchanged);
  expect(() =>
    planRenameCellTerminal(locked, "child", "formal", "IN<0:3>"),
  ).toThrow(/locked/i);
  const reduced = apply(
    project,
    planRenameCellTerminal(project, "child", "formal", "IN<3,1,0>", {
      memberMap: { [before[1]!.id]: null },
    }),
  );
  expect(reduced.documents[0]!.annotations[0]).toMatchObject({
    visible: false,
    anchor: project.documents[0]!.annotations[0]!.anchor,
    formatOverride: {
      runs: [
        {
          kind: "span",
          style: "bold",
          children: [{ kind: "text", value: "IN<3,1,0>" }],
        },
      ],
    },
  });
});

it.each(["removed", "sole survivor"])(
  "retains each selector's own qualified branch when its selected member is %s",
  (selection) => {
    let { project, before } = connectedBus();
    for (const [id, y] of [
      ["tap-a", 80],
      ["tap-b", -80],
    ] as const) {
      const cell = project.documents[0]!;
      const wire = proposeWireIntent(
        cell,
        createProjectSymbolResolver(project, builtInSymbols),
        {
          id,
          from: {
            kind: "endpoint",
            endpoint: {
              kind: "terminal",
              instanceId: "pin",
              pinName: "P",
              memberId: before[1]!.id,
            },
          },
          to: { kind: "free", point: { x: 100, y } },
        },
      );
      if (typeof wire === "string") throw new Error(wire);
      project = apply(project, [
        {
          kind: "transact_document",
          documentId: cell.id,
          expectedRevision: cell.revision,
          edits: wire.edits,
        },
      ]);
    }
    const reduced = apply(
      project,
      planRenameCellTerminal(
        project,
        "child",
        "formal",
        selection === "removed" ? "IN<3,1,0>" : "IN<2>",
        {
          memberMap:
            selection === "removed"
              ? { [before[1]!.id]: null }
              : Object.fromEntries(
                  before
                    .filter((member) => member.id !== before[1]!.id)
                    .map((member) => [member.id, null]),
                ),
        },
      ),
    );
    const cell = parseProject(serializeProject(reduced)).documents[0]!;
    expect(
      cell.annotations.filter(
        (annotation) =>
          annotation.binding?.kind === "net-name" &&
          annotation.binding.memberEndpoint,
      ).length,
    ).toBe(2);
    for (const annotation of cell.annotations) {
      if (
        annotation.binding?.kind !== "net-name" ||
        !annotation.binding.memberEndpoint ||
        annotation.anchor.kind !== "route"
      )
        continue;
      const routeId = annotation.anchor.routeId;
      expect(annotation.binding.memberEndpoint).toEqual(
        cell.routes.find((route) => route.id === routeId)!.start,
      );
    }
  },
);

it.each(["generated", "custom"])(
  "migrates every wired %s caller and rejects a stale caller without partial changes",
  (artwork) => {
    let { project, before } = connectedBus();
    const parent = createEmptyDocument("parent", "Parent");
    const custom = createBlockSymbol({
      id: "custom-bus",
      name: "Custom Bus",
      terminals: [
        {
          id: "formal",
          name: "IN<3:0>",
          direction: "input",
          signalMembers: before.map(({ id, name }) => ({ id, name })),
        },
      ],
    });
    if (artwork === "custom")
      project.componentDefinitions = [{ symbol: custom }];
    for (const [id, y] of [
      ["X1", 0],
      ["X2", 200],
    ] as const)
      parent.instances.push({
        id,
        reference: id,
        symbolId:
          artwork === "custom"
            ? custom.id
            : hierarchicalSymbolId(project.documents[0]!.netlist!.name),
        placement: { position: { x: 200, y }, rotation: 0, mirror: "none" },
        netlist: {
          binding: { kind: "subcircuit", childDocumentId: "child" },
          parameters: {},
        },
      });
    project = apply(project, [{ kind: "add_document", document: parent }]);
    for (const id of ["X1", "X2"]) {
      const cell = project.documents.find(
        (document) => document.id === "parent",
      )!;
      const wire = proposeWireIntent(
        cell,
        createProjectSymbolResolver(project, builtInSymbols),
        {
          id: `${id}-wire`,
          from: {
            kind: "endpoint",
            endpoint: { kind: "terminal", instanceId: id, pinName: "IN<3:0>" },
          },
          to: { kind: "free", point: { x: 0, y: id === "X1" ? 0 : 200 } },
        },
      );
      if (typeof wire === "string") throw new Error(wire);
      project = apply(project, [
        {
          kind: "transact_document",
          documentId: "parent",
          expectedRevision: cell.revision,
          edits: wire.edits,
        },
      ]);
    }
    const edits = planRenameCellTerminal(
      project,
      "child",
      "formal",
      "IN<3,1,0>",
      { memberMap: { [before[1]!.id]: null } },
    );
    const stale = structuredClone(project);
    stale.documents.find((document) => document.id === "parent")!.revision += 1;
    const rejected = executeProjectTransaction(stale, {
      transactionId: "stale",
      projectId: stale.id,
      expectedStructureRevision: stale.structureRevision,
      actor: { kind: "human", id: "test" },
      edits,
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.project).toEqual(stale);
    const reduced = apply(project, edits);
    const resolver = createProjectSymbolResolver(reduced, builtInSymbols);
    for (const instance of reduced.documents.find(
      (document) => document.id === "parent",
    )!.instances)
      expect(
        resolver
          .resolve(instance.symbolId)!
          .definition.pins.find((pin) => pin.name === "IN<3,1,0>")
          ?.signalMembers?.map((member) => member.id),
      ).toEqual([before[0]!.id, before[2]!.id, before[3]!.id]);
    const caller = parseProject(serializeProject(reduced)).documents.find(
      (document) => document.id === "parent",
    )!;
    expect(
      caller.routes
        .filter((route) => route.start.kind === "terminal")
        .map((route) => route.members!.map((member) => member.startMemberId)),
    ).toEqual([
      [before[0]!.id, before[2]!.id, before[3]!.id],
      [before[0]!.id, before[2]!.id, before[3]!.id],
    ]);
    expect(
      caller.nets
        .flatMap((net) => net.terminals)
        .every(
          (endpoint) =>
            endpoint.memberId !== before[1]!.id &&
            endpoint.pinName === "IN<3,1,0>",
        ),
    ).toBe(true);
  },
);

it("deliberately converts a legacy scalar contact to one chosen member without fanout", () => {
  let project = createEmptyProject("legacy", "Legacy", "child");
  const endpoint = {
    kind: "terminal" as const,
    instanceId: "pin",
    pinName: "P",
  };
  project = apply(
    project,
    planCreateCellPin(project, "child", {
      instance: {
        id: "pin",
        symbolId: "port",
        placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      },
      terminal: {
        id: "legacy-port",
        name: "DATA<3:0>",
        netId: "old-scalar",
        direction: "input",
        interfaceInstanceIds: ["pin"],
      },
      connectionEdits: [
        {
          kind: "connect_endpoints",
          from: endpoint,
          to: endpoint,
          newNetId: "old-scalar",
        },
      ],
    }),
  );
  const route = proposeWireIntent(
    project.documents[0]!,
    createProjectSymbolResolver(project, builtInSymbols),
    {
      id: "old-wire",
      from: { kind: "endpoint", endpoint },
      to: { kind: "free", point: { x: 100, y: 0 } },
    },
  );
  if (typeof route === "string") throw new Error(route);
  project = apply(project, [
    {
      kind: "transact_document",
      documentId: "child",
      expectedRevision: project.documents[0]!.revision,
      edits: route.edits,
    },
  ]);
  const oldText = serializeProject(project);
  const legacy = parseProject(oldText);
  expect(legacy.documents[0]!.netlist!.terminals[0]!.signal).toBeUndefined();
  expect(() =>
    planSetCellTerminalSignal(legacy, "child", "legacy-port", "DATA<3:0>", {
      convertLegacy: true,
    }),
  ).toThrow(/mapping|disconnect/i);
  const caller = createEmptyDocument("legacy-caller", "Legacy caller");
  caller.instances.push({
    id: "X1",
    reference: "X1",
    symbolId: hierarchicalSymbolId(legacy.documents[0]!.netlist!.name),
    placement: null,
    netlist: {
      binding: { kind: "subcircuit", childDocumentId: "child" },
      parameters: {},
    },
  });
  caller.noConnects.push({
    id: "nc",
    endpoint: { kind: "terminal", instanceId: "X1", pinName: "DATA<3:0>" },
  });
  const marked = apply(legacy, [{ kind: "add_document", document: caller }]);
  const convertedMark = apply(
    marked,
    planSetCellTerminalSignal(marked, "child", "legacy-port", "DATA<3:0>", {
      convertLegacy: true,
      memberMap: { "legacy-port": "DATA<1>" },
    }),
  );
  expect(
    parseProject(serializeProject(convertedMark)).documents.find(
      (document) => document.id === "legacy-caller",
    )!.noConnects,
  ).toEqual([
    {
      id: "nc",
      endpoint: {
        kind: "terminal",
        instanceId: "X1",
        pinName: "DATA<3:0>",
        memberId: "legacy-port",
      },
    },
  ]);
  const converted = apply(
    legacy,
    planSetCellTerminalSignal(legacy, "child", "legacy-port", "DATA<3:0>", {
      convertLegacy: true,
      memberMap: { "legacy-port": "DATA<1>" },
    }),
  );
  const reopened = parseProject(serializeProject(converted)).documents[0]!;
  expect(
    reopened.netlist!.terminals[0]!.signal!.members.map(
      (member) => member.name,
    ),
  ).toEqual(["DATA<3>", "DATA<2>", "DATA<1>", "DATA<0>"]);
  expect(reopened.routes[0]!.start).toEqual({
    ...endpoint,
    memberId: "legacy-port",
  });
  expect(reopened.routes[0]!.members).toBeUndefined();
  expect(reopened.routes[0]!.netId).toBe("old-scalar");
  expect(serializeProject(legacy)).toBe(oldText);
});

it.each([
  ["rename terminal", planRenameCellTerminal],
  ["set terminal signal", planSetCellTerminalSignal],
] as const)(
  "honors explicit same-expression Cell permutations and validates maps: %s",
  (_scenario, plan) => {
    const { project, before } = connectedBus();
    const expression = "IN<3:0>";
    expect(() =>
      plan(project, "child", "formal", expression, {
        memberMap: { unknown: "IN<3>" },
      }),
    ).toThrow(/unknown/i);
    expect(() =>
      plan(project, "child", "formal", expression, {
        memberMap: { [before[0]!.id]: "IN<2>" },
      }),
    ).toThrow(/multiple/i);
    const result = apply(
      project,
      plan(project, "child", "formal", expression, {
        memberMap: Object.fromEntries(
          before.map((member, index) => [member.id, before[3 - index]!.name]),
        ),
      }),
    );
    const changed = parseProject(serializeProject(result)).documents[0]!;
    expect(changed.netlist!.terminals[0]!.name).toBe(expression);
    expect(
      changed.netlist!.terminals[0]!.signal!.members.map((member) => member.id),
    ).toEqual([...before].reverse().map((member) => member.id));
    expect(changed.nets).toEqual(
      parseProject(serializeProject(project)).documents[0]!.nets,
    );
  },
);

it("honors explicit disconnection when a one-member signal keeps its expression", () => {
  const { project, before } = connectedBus();
  const scalar = apply(
    project,
    planRenameCellTerminal(project, "child", "formal", "IN<3>", {
      memberMap: Object.fromEntries(
        before.slice(1).map((member) => [member.id, null]),
      ),
    }),
  );
  const replaced = apply(
    scalar,
    planRenameCellTerminal(scalar, "child", "formal", "IN<3>", {
      memberMap: { [before[0]!.id]: null },
    }),
  );
  const document = parseProject(serializeProject(replaced)).documents[0]!;
  expect(document.netlist!.terminals[0]!.signal!.members[0]!.id).not.toBe(
    before[0]!.id,
  );
  expect(
    document.nets.find((net) => net.id === before[0]!.netId)!.terminals,
  ).toEqual([{ instanceId: "load", pinName: "2" }]);
});
