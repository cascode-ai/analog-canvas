import { importNetlistSources } from "../netlist-export/netlist-source-import";
import { planPropertyApply } from "../properties/property-apply-plan";
import { describe, expect, it } from "vitest";
import {
  DocumentHistory,
  executeProjectTransaction,
  planCreateCellPin,
  proposeWireIntent,
  type SchematicEdit,
  type ProjectStructureEdit,
} from "@icm/edit-engine";
import {
  createEmptyDocument,
  createEmptyProject,
  createRoutePath,
  type SchematicDocument,
} from "@icm/model";
import { createDesignNetlistExport } from "@icm/netlist";
import { parseProject, serializeProject } from "@icm/project-protocol";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  hierarchicalSymbolId,
} from "@icm/symbols";
import {
  planCreateInstanceArray,
  planInstanceArrayConnection,
} from "@icm/edit-engine";

function arrayFixture() {
  let project = createEmptyProject("arrays", "Arrays", "parent");
  const child = createEmptyDocument("unit", "switch_unit");
  child.netlist!.formalParameters = [{ name: "w", defaultValue: "1u" }];
  project.documents.push(child);
  for (const [documentId, name, x] of [
    ["parent", "VSS", -100],
    ["parent", "EN<3:0>", -80],
    ["unit", "CTRL", -100],
    ["unit", "VSS", -80],
  ] as const) {
    const id = `${documentId}-port-${x}`;
    const result = executeProjectTransaction(project, {
      projectId: project.id,
      transactionId: id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "array-editor" },
      edits: planCreateCellPin(project, documentId, {
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
        signalExpression: name,
        connectionEdits: [],
      }),
    });
    if (!result.ok) throw new Error(result.error.message);
    project = result.project;
  }
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  const history = new DocumentHistory(project.documents[0]!, {
    symbolResolver: resolver,
  });
  let sequence = 0;
  const apply = (...edits: SchematicEdit[]) => {
    const result = history.transact({
      documentId: history.document.id,
      transactionId: `array-edit-${++sequence}`,
      expectedRevision: history.document.revision,
      actor: { kind: "human", id: "array-editor" },
      edits,
    });
    if (!result.ok) throw new Error(JSON.stringify(result));
  };
  apply({
    kind: "add_instance",
    instance: {
      id: "seed",
      reference: "X3",
      symbolId: hierarchicalSymbolId("switch_unit"),
      placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
      netlist: {
        binding: { kind: "subcircuit", childDocumentId: "unit" },
        parameters: { w: "1u" },
      },
    },
  });
  return {
    history,
    apply,
    resolver,
    snapshot: () => ({
      ...project,
      documents: [history.document, project.documents[1]!],
    }),
  };
}

describe("native Instance arrays", () => {
  it("uses a connectable contact of a shared Net that also has a property-only terminal", () => {
    const { history, apply, resolver } = arrayFixture();
    apply(
      ...planCreateInstanceArray(
        history.document,
        "seed",
        { prefix: "X", first: 3, last: 0 },
        "array",
      ),
    );
    const source = structuredClone(history.document);
    const supply = source.netlist!.terminals.find(
      ({ name }) => name === "VSS",
    )!;
    source.instances.push({
      id: "substrate-source",
      symbolId: "resistor",
      reference: "R1",
      placement: null,
      netlist: {
        binding: {
          kind: "external-subcircuit",
          definitionId: "sky-res-high-po",
        },
        parameters: {},
      },
    });
    source.nets
      .find(({ id }) => id === supply.netId)!
      .terminals.unshift({
        instanceId: "substrate-source",
        pinName: "B",
      });
    history.reset(source);
    const group = history.document.instanceGroups![0]!;
    const plan = planInstanceArrayConnection(
      history.document,
      resolver,
      group,
      "VSS",
      "VSS",
      false,
    );
    apply(...plan.edits);
    expect(
      history.document.nets.find(({ id }) => id === supply.netId)?.terminals,
    ).toEqual(
      expect.arrayContaining(
        group.memberIds.map((instanceId) => ({ instanceId, pinName: "VSS" })),
      ),
    );
  });
  it("creates and connects real members in order and reverses all bits in one undoable edit", () => {
    const { history, apply, resolver, snapshot } = arrayFixture();
    apply(
      ...planCreateInstanceArray(
        history.document,
        "seed",
        { prefix: "X", first: 3, last: 0 },
        "array",
      ),
    );
    const group = history.document.instanceGroups![0]!;
    expect(group.memberIds[0]).toBe("seed");
    const references = () =>
      group.memberIds.map(
        (id) =>
          history.document.instances.find((part) => part.id === id)?.reference,
      );
    expect(references()).toEqual(["X3", "X2", "X1", "X0"]);
    const connect = (pin: string, expression: string, reverse = false) =>
      planInstanceArrayConnection(
        history.document,
        resolver,
        group,
        pin,
        expression,
        reverse,
      );
    apply(...connect("VSS", "VSS").edits);
    apply(...connect("CTRL", "EN<3:0>").edits);
    const port = history.document.netlist!.terminals.find(
      ({ name }) => name === "EN<3:0>",
    )!;
    const bit = port.signal!.members[0]!;
    apply({
      kind: "set_route_path",
      route: createRoutePath({
        id: "visible-control",
        netId: bit.netId,
        start: { kind: "terminal", instanceId: "seed", pinName: "CTRL" },
        end: {
          kind: "terminal",
          instanceId: port.interfaceInstanceIds[0]!,
          pinName: "P",
          memberId: bit.id,
        },
        bends: [{ x: 40, y: 50 }],
        modes: ["manual", "manual"],
      }),
    });
    const before = serializeProject(snapshot());
    expect(() => connect("CTRL", "EN<2:0>")).toThrow(/4 members.*3/u);
    expect(serializeProject(snapshot())).toBe(before);
    expect(
      connect("CTRL", "EN<3:0>", true).rows.map(({ reference, net }) => [
        reference,
        net,
      ]),
    ).toEqual([
      ["X3", "EN<0>"],
      ["X2", "EN<1>"],
      ["X1", "EN<2>"],
      ["X0", "EN<3>"],
    ]);
    const output = (format: "spice" | "spectre") => {
      const result = createDesignNetlistExport(
        parseProject(serializeProject(snapshot())),
        { format },
      );
      if (result.status !== "ready")
        throw new Error(JSON.stringify(result.diagnostics));
      return result.file.text
        .split("\n")
        .filter((line) => /^X[0-3] /u.test(line));
    };
    const forward = output("spice");
    expect(forward).toHaveLength(4);
    expect(forward).toContain("X3 VSS EN_3_ switch_unit w=1u");
    apply(...connect("CTRL", "EN<3:0>", true).edits);
    expect(
      history.document.routes.find(({ id }) => id === "visible-control"),
    ).toBeUndefined();
    const reversed = output("spice");
    expect(reversed).toContain("X3 VSS EN_0_ switch_unit w=1u");
    expect(reversed).toContain("X0 VSS EN_3_ switch_unit w=1u");
    apply({ kind: "undo" });
    expect(
      history.document.routes.find(({ id }) => id === "visible-control"),
    ).toBeDefined();
    expect(output("spice")).toEqual(forward);
    apply({ kind: "redo" });
    expect(output("spice")).toEqual(reversed);
    apply({
      kind: "patch_instance_netlist_parameters",
      instanceId: group.memberIds[1]!,
      set: { w: "2u" },
    });
    expect(output("spice").sort()).toEqual([
      "X0 VSS EN_3_ switch_unit w=1u",
      "X1 VSS EN_2_ switch_unit w=1u",
      "X2 VSS EN_1_ switch_unit w=2u",
      "X3 VSS EN_0_ switch_unit w=1u",
    ]);
    expect(output("spectre").sort()).toEqual([
      "X0 (VSS EN\\<3\\>) switch_unit w=1u",
      "X1 (VSS EN\\<2\\>) switch_unit w=1u",
      "X2 (VSS EN\\<1\\>) switch_unit w=2u",
      "X3 (VSS EN\\<0\\>) switch_unit w=1u",
    ]);
    expect(
      parseProject(serializeProject(snapshot())).documents[0]!.instanceGroups,
    ).toEqual([group]);
    expect(references()).toEqual(["X3", "X2", "X1", "X0"]);
  });
});

it("keeps all seven offset bits through two callers, node probes and both netlist readers", async () => {
  let project = createEmptyProject("handoff", "Top", "parent");
  project.documents.push(createEmptyDocument("loads", "Loads"));
  const cell = (id: string) => project.documents.find((doc) => doc.id === id)!;
  const apply = (edits: ProjectStructureEdit[]) => {
    const result = executeProjectTransaction(project, {
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      transactionId: `fixture-${project.structureRevision}`,
      actor: { kind: "human", id: "array-test" },
      edits,
    });
    if (!result.ok) throw new Error(result.error.message);
    project = result.project;
  };
  const edit = (id: string, edits: SchematicEdit[]) =>
    apply([
      {
        kind: "transact_document",
        documentId: id,
        expectedRevision: cell(id).revision,
        edits,
      },
    ]);
  const place = (x: number, y = 0) => ({
    position: { x, y },
    rotation: 0 as const,
    mirror: "none" as const,
  });
  for (const [id, pin, name, x] of [
    ["loads", "data", "DOUT<7:1>", 0],
    ["loads", "return", "VSS", 100],
    ["parent", "left", "LEFT<7:1>", 0],
    ["parent", "right", "RIGHT<1:7>", 100],
    ["parent", "common", "GNDREF", 200],
  ] as const) {
    apply(
      planCreateCellPin(project, id, {
        instance: { id: pin, symbolId: "port", placement: place(x) },
        terminal: {
          id: pin + "-formal",
          name,
          netId: pin + "-net",
          direction: "passive",
          interfaceInstanceIds: [pin],
        },
        signalExpression: name,
        connectionEdits: [],
      }),
    );
  }
  edit("loads", [
    {
      kind: "add_instance",
      instance: {
        id: "seed",
        reference: "R1",
        symbolId: "resistor",
        placement: place(300),
        netlist: {
          binding: { kind: "primitive", deviceClass: "resistor" },
          parameters: { value: "1k" },
        },
      },
    },
  ]);
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  const seed = cell("loads").instances.find((i) => i.id === "seed")!;
  const plan = planPropertyApply(
    { project, document: cell("loads"), instance: seed, resolver },
    {
      placement: null,
      appearance: { color: "auto" },
      netlistName: "RLOAD<6:0>",
    },
  );
  if (plan.kind !== "edits") throw new Error(JSON.stringify(plan));
  expect(plan.edits).toEqual(
    planCreateInstanceArray(cell("loads"), seed.id, {
      prefix: "RLOAD",
      first: 6,
      last: 0,
    }),
  );
  edit("loads", plan.edits);
  const group = cell("loads").instanceGroups![0]!;
  for (const [pin, expression] of [
    ["1", "DOUT<7:1>"],
    ["2", "VSS"],
  ] as const) {
    const mapping = planInstanceArrayConnection(
      cell("loads"),
      resolver,
      group,
      pin,
      expression,
      false,
    );
    edit("loads", mapping.edits);
  }
  const formal = cell("loads").netlist!.terminals.find(
    (p) => p.name === "DOUT<7:1>",
  )!;
  for (const [call, port, x] of [
    ["XA", "left", 300],
    ["XB", "right", 400],
  ] as const) {
    edit("parent", [
      {
        kind: "add_instance",
        instance: {
          id: call,
          reference: call,
          symbolId: hierarchicalSymbolId("Loads"),
          placement: place(x, port === "left" ? 100 : 300),
          netlist: {
            binding: { kind: "subcircuit", childDocumentId: "loads" },
            parameters: {},
          },
        },
      },
      {
        kind: "connect_endpoints",
        from: { kind: "terminal", instanceId: call, pinName: "VSS" },
        to: { kind: "terminal", instanceId: "common", pinName: "P" },
      },
    ]);
    const bus = proposeWireIntent(cell("parent"), resolver, {
      id: "bus-" + port,
      from: {
        kind: "endpoint",
        endpoint: { kind: "terminal", instanceId: port, pinName: "P" },
      },
      to: {
        kind: "endpoint",
        endpoint: { kind: "terminal", instanceId: call, pinName: formal.name },
      },
    });
    if (typeof bus === "string") throw new Error(bus);
    edit("parent", bus.edits);
  }
  project = parseProject(serializeProject(project));
  expect(cell("loads").instanceGroups).toEqual([group]);
  const rows = [
    ["RLOAD6", 7, 1],
    ["RLOAD5", 6, 2],
    ["RLOAD4", 5, 3],
    ["RLOAD3", 4, 4],
    ["RLOAD2", 3, 5],
    ["RLOAD1", 2, 6],
    ["RLOAD0", 1, 7],
  ] as const;
  function formalAtPin(doc: SchematicDocument, reference: string, pin: string) {
    const instance = doc.instances.find(
      (part) => part.reference === reference,
    )!;
    const net = doc.nets.find((net) =>
      net.terminals.some(
        (t) => t.instanceId === instance.id && t.pinName === pin,
      ),
    );
    return doc.netlist!.terminals.find((t) => t.netId === net?.id)?.name;
  }
  for (const format of ["spice", "spectre"] as const) {
    const out = createDesignNetlistExport(project, {
      format,
      includeNodeLocations: true,
    });
    if (out.status !== "ready")
      throw new Error(JSON.stringify(out.diagnostics));
    const path = format === "spice" ? "top.spi" : "top.scs";
    const imported = await importNetlistSources(
      [{ path, bytes: new TextEncoder().encode(out.file.text) }],
      path,
    );
    if (imported.status !== "imported")
      throw new Error(JSON.stringify(imported.diagnostics));
    const loads = imported.project.documents.find(
      (doc) => doc.netlist?.name === "Loads",
    )!;
    const top = imported.project.documents.find((doc) =>
      doc.instances.some((part) => part.reference === "XA"),
    )!;
    expect(
      loads.instances.filter((part) => part.symbolId === "resistor"),
    ).toHaveLength(7);
    expect(loads.instanceGroups ?? []).toHaveLength(0);
    for (const [index, [name, descending, ascending]] of rows.entries()) {
      const bit = formalAtPin(loads, name, "1")!;
      // Actual node spelling is dialect-specific. Identity must survive both positional calls.
      const spelling = (prefix: string, n: number) =>
        format === "spice" ? `${prefix}_${n}_` : `${prefix}<${n}>`;
      expect(bit).toBe(spelling("DOUT", descending));
      expect(formalAtPin(loads, name, "2")).toBe("VSS");
      expect(formalAtPin(top, "XA", bit)).toBe(spelling("LEFT", descending));
      expect(formalAtPin(top, "XB", bit)).toBe(spelling("RIGHT", ascending));
      const probe = out.locations.nodes?.find(
        (node) =>
          node.documentId === "loads" &&
          node.instanceId === group.memberIds[index] &&
          node.endpoint?.pinName === "1",
      );
      expect(probe).toBeDefined();
      expect(
        out.file.text
          .slice(probe!.startOffset, probe!.endOffset)
          .replaceAll("\\", ""),
      ).toBe(bit);
    }
    for (const call of ["XA", "XB"])
      expect(formalAtPin(top, call, "VSS")).toBe("GNDREF");
  }
});
