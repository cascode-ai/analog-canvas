import { expect, it } from "vitest";
import {
  createEmptyProject,
  createEmptyDocument,
  flattenRichText,
  semanticTextDocument,
  type CircuitProject,
} from "@icm/model";
import { parseProject, serializeProject } from "@icm/project-protocol";
import {
  resolveAnnotationText,
  resolveDocumentLogicalNets,
} from "@icm/derived";
import { analyzeDesignNetlist } from "@icm/netlist";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  hierarchicalSymbolId,
} from "@icm/symbols";
import { planCreateCellPin } from "./cell-pin-planner.js";
import { proposeWireIntent } from "./wire-intent-planner.js";
import {
  executeProjectTransaction,
  type ProjectStructureEdit,
} from "./project-transaction.js";
import {
  createFreeWireAnchor,
  createRouteWireAnchor,
  proposeWireCommit,
  type WireSource,
} from "./wire-commit-planner.js";
import {
  selectWireExpression,
  selectWireMembers,
  evaluateWireMembers,
} from "./wire-member-choice.js";
import {
  planNamedWireEdits,
  planEnsureNamedRoute,
  prepareNamedWireSource,
} from "./signal-wire-planner.js";

function apply(project: CircuitProject, edits: ProjectStructureEdit[]) {
  const result = executeProjectTransaction(project, {
    transactionId: `edit-${project.structureRevision}`,
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    actor: { kind: "human", id: "slice-test" },
    edits,
  });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.project;
}
function fixture(expression: string) {
  const project = createEmptyProject("slices", "Slices", "cell");
  return apply(
    project,
    planCreateCellPin(project, "cell", {
      instance: {
        id: "P1",
        symbolId: "port",
        placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      },
      terminal: {
        id: "input",
        name: expression,
        netId: "input-net",
        direction: "input",
        interfaceInstanceIds: ["P1"],
      },
      connectionEdits: [],
      signalExpression: expression,
    }),
  );
}
function source(project: CircuitProject): WireSource {
  const members = project.documents[0]!.netlist!.terminals[0]!.signal!.members;
  const endpoint = {
    kind: "terminal" as const,
    instanceId: "P1",
    pinName: "P",
  };
  return {
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
  };
}
function wire(
  project: CircuitProject,
  from: WireSource,
  id: string,
  x: number,
  y: number,
) {
  const document = project.documents[0]!;
  const proposal = proposeWireCommit(
    from,
    createFreeWireAnchor({ x, y }, from.netId!, false, `${id}-end`),
    [],
    { routeId: id, newNetId: `${id}-net` },
  );
  return apply(project, [
    {
      kind: "transact_document",
      documentId: document.id,
      expectedRevision: document.revision,
      edits: proposal.edits,
    },
  ]);
}

it.each([false, true])(
  "keeps an explicitly named loose scalar scalar at a bus landing (reverse=%s)",
  (reverse) => {
    const project = fixture("DATA<3:0>");
    const document = project.documents[0]!;
    const bus = source(project);
    const loose = createFreeWireAnchor(
      { x: 100, y: 0 },
      "loose",
      true,
      "loose",
    );
    const named = prepareNamedWireSource(loose, "CLK");
    const from = reverse ? bus : named;
    const to = reverse ? named : bus;
    const choice = evaluateWireMembers(document, from, to);
    expect(choice.kind).toBe("choose");
    if (choice.kind !== "choose") return;
    expect(choice.choice.expectedWidth).toBe(1);
    expect(() => proposeWireCommit(from, to, [], 99)).toThrow(
      /Select one bus member/,
    );
    const selected = selectWireMembers(bus, [bus.members![2]!.id]);
    const proposal = proposeWireCommit(
      reverse ? selected : named,
      reverse ? named : selected,
      [],
      1,
    );
    const result = apply(project, [
      {
        kind: "transact_document",
        documentId: document.id,
        expectedRevision: document.revision,
        edits: proposal.edits,
      },
    ]);
    const saved = parseProject(serializeProject(result)).documents[0]!;
    const logical = resolveDocumentLogicalNets(saved);
    expect(saved.routes[0]!.members).toBeUndefined();
    expect(
      logical.byBaseNetId.get(
        saved.junctions.find((item) => item.id === "loose")!.netId,
      )?.id,
    ).toBe(logical.byBaseNetId.get(bus.members![2]!.netId)?.id);
    expect(
      new Set(
        bus.members!.map((member) => logical.byBaseNetId.get(member.netId)?.id),
      ).size,
    ).toBe(4);
    expect(evaluateWireMembers(document, loose, bus).kind).toBe("ready");
    expect(
      evaluateWireMembers(
        document,
        prepareNamedWireSource(named, "DATA<3:0>"),
        bus,
      ).kind,
    ).toBe("ready");
  },
);

it.each(["data<3>,DATA<2>", "<3,2>"])(
  "selects members using electrical case folding for %s",
  (expression) => {
    const project = fixture("DATA<3>,data<2>,DATA<1:0>");
    const selected = selectWireExpression(
      project.documents[0]!,
      source(project),
      expression,
    );
    const result = wire(project, selected, "case-selected", 100, 0);
    const saved = parseProject(serializeProject(result)).documents[0]!;
    expect(
      saved.routes[0]!.members!.map((member) => member.startMemberId),
    ).toEqual(
      source(project)
        .members!.slice(0, 2)
        .map((member) => member.id),
    );
  },
);

it("connects a case-equivalent inline scalar name to its unique authoritative member in one Project transaction", () => {
  const project = fixture("DATA<3:0>");
  const document = project.documents[0]!;
  const bus = source(project);
  const named = prepareNamedWireSource(
    createFreeWireAnchor({ x: 100, y: 0 }, "loose", true, "loose"),
    "data<2>",
  );
  const evaluation = evaluateWireMembers(document, named, bus);
  expect(evaluation.kind).toBe("ready");
  if (evaluation.kind !== "ready") return;
  expect(evaluation.to.endpoint.memberId).toBe(bus.members![1]!.id);
  const proposal = proposeWireCommit(evaluation.from, evaluation.to, [], 1);
  const edits = planNamedWireEdits(
    document,
    proposal.edits,
    proposal.routeId,
    {
      name: "data<2>",
      content: semanticTextDocument("data<2>", "net-label"),
      sizeScale: 1,
      alignment: "start",
      position: { x: 50, y: -4 },
    },
    { symbolResolver: createProjectSymbolResolver(project, builtInSymbols) },
  );
  const result = apply(project, [
    {
      kind: "transact_document",
      documentId: document.id,
      expectedRevision: document.revision,
      edits,
    },
  ]);
  const saved = parseProject(serializeProject(result)).documents[0]!;
  const logical = resolveDocumentLogicalNets(saved);
  expect(
    logical.byBaseNetId.get(
      saved.junctions.find((item) => item.id === "loose")!.netId,
    )?.id,
  ).toBe(logical.byBaseNetId.get(bus.members![1]!.netId)?.id);
  expect(
    new Set(
      bus.members!.map((member) => logical.byBaseNetId.get(member.netId)?.id),
    ).size,
  ).toBe(4);
});

it.each(["<3>", "<3,1>"])(
  "keeps an existing %s selector bound when its text is edited",
  (expression) => {
    const project = fixture("DATA<3:0>");
    const selected = selectWireExpression(
      project.documents[0]!,
      source(project),
      expression,
    );
    const connected = wire(project, selected, "selected", 100, 0);
    const document = connected.documents[0]!;
    const naming = planEnsureNamedRoute(document, "selected", {
      candidateNetId: document.routes[0]!.netId,
      name: expression === "<3>" ? "OTHER" : "OTHER<1:0>",
      evidenceId: "rename-selector",
      owner: { kind: "net-label", annotationId: "selected-selector" },
    });
    expect(naming.ok).toBe(false);
    if (!naming.ok) expect(naming.message).toMatch(/selector.*migration/);
  },
);

it.each([
  ["DATA<7,3,0>", ["DATA<7>", "DATA<3>", "DATA<0>"]],
  [
    "CLK,RESET,DATA<3:0>",
    ["CLK", "RESET", "DATA<3>", "DATA<2>", "DATA<1>", "DATA<0>"],
  ],
  ["A<0:1>,B<5,2>,Z", ["A<0>", "A<1>", "B<5>", "B<2>", "Z"]],
])(
  "authors and reopens ordered Cell Pin expression %s",
  (expression, names) => {
    const project = fixture(expression as string);
    const reopened = parseProject(serializeProject(project));
    const pin = reopened.documents[0]!.netlist!.terminals[0]!;
    expect(pin.signal!.members.map((member) => member.name)).toEqual(names);
    expect(
      new Set(pin.signal!.members.map((member) => member.netId)).size,
    ).toBe(names.length);
    expect(analyzeDesignNetlist(reopened).ir?.cells[0]?.ports).toHaveLength(
      names.length,
    );
  },
);

it.each([20, 80])(
  "commits an ordered subset and a nested scalar tap at x=%s with bound selectors and independent Nets",
  (splitX) => {
    let project = fixture("DATA<7:0>");
    const initial = project;
    const selected = selectWireExpression(
      project.documents[0]!,
      source(project),
      "<7,3,0>",
    );
    const ids = selected.members!.map((member) => member.id);
    project = wire(project, selected, "subset", 160, 0);
    let document = project.documents[0]!;
    const route = document.routes[0]!;
    expect(route.members!.map((member) => member.startMemberId)).toEqual(ids);
    expect(document.nets).toHaveLength(8);
    expect(document.connectivityEvidence).toEqual([]);
    const selector = document.annotations.find(
      (annotation) => annotation.id === "subset-selector",
    )!;
    expect(flattenRichText(resolveAnnotationText(document, selector))).toBe(
      "DATA<7,3,0>",
    );
    const nested = createRouteWireAnchor(
      document,
      route,
      { x: splitX, y: 0 },
      0,
      10,
      {
        junctionId: "nested-anchor",
        firstRouteId: "subset-a",
        secondRouteId: "subset-b",
      },
    );
    const scalar = selectWireExpression(document, nested, "<3>");
    project = wire(project, scalar, "nested", splitX, 100);
    document = parseProject(serializeProject(project)).documents[0]!;
    expect(document.nets).toHaveLength(8);
    expect(resolveDocumentLogicalNets(document).groups).toHaveLength(8);
    expect(document.routes.find((item) => item.id === "nested")!.netId).toBe(
      initial.documents[0]!.netlist!.terminals[0]!.signal!.members[4]!.netId,
    );
    expect(
      flattenRichText(
        resolveAnnotationText(
          document,
          document.annotations.find((item) => item.id === "subset-selector")!,
        ),
      ),
    ).toBe("DATA<7,3,0>");
  },
);

it("requires explicit member names for mixed-base shorthand and refuses invalid selections without mutation", () => {
  const project = fixture("CLK,A<3:0>,B<1:0>");
  const before = serializeProject(project);
  const bus = source(project);
  expect(() => selectWireExpression(project.documents[0]!, bus, "<1>")).toThrow(
    /context|base/iu,
  );
  expect(
    selectWireExpression(
      project.documents[0]!,
      bus,
      "B<1>,CLK,A<0>",
    ).members!.map((member) => member.name),
  ).toEqual(["B<1>", "CLK", "A<0>"]);
  expect(() =>
    selectWireExpression(project.documents[0]!, bus, "A<9>"),
  ).toThrow(/available|member/iu);
  expect(() =>
    selectWireMembers(bus, [bus.members![0]!.id, bus.members![0]!.id]),
  ).toThrow(/unique|duplicate/iu);
  expect(() => selectWireMembers(bus, [])).toThrow();
  expect(serializeProject(project)).toBe(before);
});

it("keeps ordered nested slices independent after splitting on either side of their selector", () => {
  let project = fixture("DATA<7:0>");
  project = wire(
    project,
    selectWireExpression(project.documents[0]!, source(project), "<7,3,0>"),
    "outer",
    160,
    0,
  );
  let document = project.documents[0]!;
  const outer = createRouteWireAnchor(
    document,
    document.routes[0]!,
    { x: 20, y: 0 },
    0,
    10,
    {
      junctionId: "slice-anchor",
      firstRouteId: "outer-a",
      secondRouteId: "outer-b",
    },
  );
  project = wire(
    project,
    selectWireExpression(document, outer, "<0,7>"),
    "inner",
    20,
    100,
  );
  document = parseProject(serializeProject(project)).documents[0]!;
  const inner = document.routes.find((route) => route.id === "inner")!;
  const declared = document.netlist!.terminals[0]!.signal!.members;
  expect(inner.members!.map((member) => member.netId)).toEqual([
    declared[7]!.netId,
    declared[0]!.netId,
  ]);
  expect(
    flattenRichText(
      resolveAnnotationText(
        document,
        document.annotations.find(
          (annotation) => annotation.id === "inner-selector",
        )!,
      ),
    ),
  ).toBe("DATA<0,7>");
  expect(resolveDocumentLogicalNets(document).groups).toHaveLength(8);
});

it.each([false, true])(
  "cuts a subset atomically while preserving selector locks (locked=%s)",
  (locked) => {
    let project = fixture("DATA<3:0>");
    project = wire(
      project,
      selectWireExpression(project.documents[0]!, source(project), "<3,1>"),
      "slice",
      160,
      0,
    );
    if (locked)
      project = apply(project, [
        {
          kind: "transact_document",
          documentId: "cell",
          expectedRevision: project.documents[0]!.revision,
          edits: [
            {
              kind: "upsert_schematic_annotation",
              annotation: {
                ...project.documents[0]!.annotations[0]!,
                locked: true,
              },
            },
          ],
        },
      ]);
    const before = serializeProject(project);
    const result = executeProjectTransaction(project, {
      transactionId: "cut",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: [
        {
          kind: "transact_document",
          documentId: "cell",
          expectedRevision: project.documents[0]!.revision,
          edits: [{ kind: "cut_connection", routeId: "slice" }],
        },
      ],
    });
    expect(result.ok, JSON.stringify(result)).toBe(!locked);
    if (result.ok) {
      expect(result.project.documents[0]!.routes).toEqual([]);
      expect(result.project.documents[0]!.annotations).toEqual([]);
      expect(result.project.documents[0]!.nets).toHaveLength(4);
    } else expect(serializeProject(result.project)).toBe(before);
  },
);

it("accepts bounded 256-member declarations and maximum indexed members", () => {
  expect(
    fixture("A<255:0>").documents[0]!.netlist!.terminals[0]!.signal!.members,
  ).toHaveLength(256);
  expect(
    fixture(
      "A<65535>,B",
    ).documents[0]!.netlist!.terminals[0]!.signal!.members.map(
      (member) => member.name,
    ),
  ).toEqual(["A<65535>", "B"]);
});

it.each([
  "A<1,,0>",
  "A<1,>",
  "A<3:0>,",
  "A,,B",
  "A<65536>",
  "A<0:255>,B",
  "A<1:0",
  "A<2:1:0>",
  "CLK,clk",
  "DATA<1>,data<1>",
])("rejects malformed or unbounded Cell Pin %s atomically", (expression) => {
  expect(() => fixture(expression)).toThrow();
});

it.each([
  [false, 1],
  [true, 1],
  [false, 3],
  [true, 3],
] as const)(
  "draws a scalar tap from a completely unconnected hierarchical bus member, reverse=%s high=%s",
  (reverse, high) => {
    let project = fixture(`DATA<${high}:0>`);
    const child = project.documents[0]!;
    const parent = createEmptyDocument("parent", "Parent");
    parent.instances.push({
      id: "caller",
      symbolId: hierarchicalSymbolId(child.netlist!.name),
      reference: "X1",
      placement: { position: { x: 200, y: 0 }, rotation: 0, mirror: "none" },
      netlist: {
        parameters: {},
        binding: { kind: "subcircuit", childDocumentId: child.id },
      },
    });
    project = apply(project, [{ kind: "add_document", document: parent }]);
    const document = project.documents.find((cell) => cell.id === parent.id)!;
    const start = {
      kind: "endpoint",
      endpoint: {
        kind: "terminal",
        instanceId: "caller",
        pinName: `DATA<${high}:0>`,
      },
      selectionExpression: `DATA<${high}>`,
    } as const;
    const finish = { kind: "free", point: { x: 0, y: 100 } } as const;
    const proposal = proposeWireIntent(
      document,
      createProjectSymbolResolver(project, builtInSymbols),
      {
        id: "first-tap",
        from: reverse ? finish : start,
        to: reverse ? start : finish,
      },
    );
    if (typeof proposal === "string") throw new Error(proposal);
    project = apply(project, [
      {
        kind: "transact_document",
        documentId: parent.id,
        expectedRevision: document.revision,
        edits: proposal.edits,
      },
    ]);
    const result = project.documents.find((cell) => cell.id === parent.id)!;
    const member = child.netlist!.terminals[0]!.signal!.members[0]!;
    expect(result.nets.flatMap((net) => net.terminals)).toEqual([
      { instanceId: "caller", pinName: `DATA<${high}:0>`, memberId: member.id },
    ]);
    expect(result.routes).toHaveLength(1);
    expect(
      result.annotations.map((annotation) =>
        flattenRichText(
          resolveAnnotationText(
            result,
            annotation,
            undefined,
            createProjectSymbolResolver(project, builtInSymbols),
          ),
        ),
      ),
    ).toEqual([`DATA<${high}>`]);
  },
);

it.each([
  [1, false],
  [3, true],
] as const)(
  "preserves the selected member when a second fan-out branch shares the first branch path, high=%s preconnected=%s",
  (high, preconnected) => {
    let project = fixture(`DATA<${high}:0>`);
    const child = project.documents[0]!;
    const parent = createEmptyDocument("parent", "Parent");
    parent.instances.push({
      id: "caller",
      symbolId: hierarchicalSymbolId(child.netlist!.name),
      reference: "X1",
      placement: { position: { x: 200, y: 0 }, rotation: 0, mirror: "none" },
      netlist: {
        parameters: {},
        binding: { kind: "subcircuit", childDocumentId: child.id },
      },
    });
    project = apply(project, [{ kind: "add_document", document: parent }]);
    if (preconnected) {
      project = apply(project, [
        {
          kind: "transact_document",
          documentId: parent.id,
          expectedRevision: 0,
          edits: [
            {
              kind: "add_junction",
              junctionId: "existing-member-contact",
              netId: "caller-member-net",
              createNet: true,
              position: { x: 400, y: 0 },
            },
            {
              kind: "connect_endpoints",
              from: {
                kind: "terminal",
                instanceId: "caller",
                pinName: `DATA<${high}:0>`,
                memberId: child.netlist!.terminals[0]!.signal!.members[0]!.id,
              },
              to: { kind: "junction", junctionId: "existing-member-contact" },
            },
          ],
        },
      ]);
    }
    for (const [index, x] of [0, 100].entries()) {
      const document = project.documents.find((cell) => cell.id === parent.id)!;
      const proposal = proposeWireIntent(
        document,
        createProjectSymbolResolver(project, builtInSymbols),
        {
          id: `fanout-${index}`,
          from: {
            kind: "endpoint",
            endpoint: {
              kind: "terminal",
              instanceId: "caller",
              pinName: `DATA<${high}:0>`,
            },
            selectionExpression: `DATA<${high}>`,
          },
          to: { kind: "free", point: { x, y: 100 } },
        },
      );
      if (typeof proposal === "string") throw new Error(proposal);
      project = apply(project, [
        {
          kind: "transact_document",
          documentId: parent.id,
          expectedRevision: document.revision,
          edits: proposal.edits,
        },
      ]);
    }
    const result = project.documents.find((cell) => cell.id === parent.id)!;
    const member = child.netlist!.terminals[0]!.signal!.members[0]!;
    expect(result.nets.flatMap((net) => net.terminals)).toEqual([
      { instanceId: "caller", pinName: `DATA<${high}:0>`, memberId: member.id },
    ]);
    expect(
      result.annotations.map((annotation) =>
        flattenRichText(
          resolveAnnotationText(
            result,
            annotation,
            undefined,
            createProjectSymbolResolver(project, builtInSymbols),
          ),
        ),
      ),
    ).toEqual([`DATA<${high}>`, `DATA<${high}>`]);
    expect(
      result.junctions.some(
        (junction) => junction.position.x === 0 && junction.position.y === 100,
      ),
    ).toBe(true);
    expect(
      result.junctions.some(
        (junction) =>
          junction.position.x === 100 && junction.position.y === 100,
      ),
    ).toBe(true);
  },
);
