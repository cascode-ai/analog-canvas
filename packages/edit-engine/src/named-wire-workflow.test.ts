import { expect, it } from "vitest";
import { createEmptyProject, semanticTextDocument } from "@icm/model";
import { parseProject, serializeProject } from "@icm/project-protocol";
import { resolveVisualAnchor } from "@icm/derived";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import {
  createFreeWireAnchor,
  proposeWireCommit,
} from "./wire-commit-planner.js";
import {
  planNamedWireEdits,
  prepareNamedWireSource,
  planEnsureNamedRoute,
} from "./signal-wire-planner.js";
import { executeProjectTransaction } from "./project-transaction.js";

it.each([
  [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 50, y: -4 },
  ],
  [
    { x: 100, y: 0 },
    { x: 0, y: 0 },
    { x: 50, y: -4 },
  ],
  [
    { x: 0, y: 0 },
    { x: 0, y: 100 },
    { x: 8, y: 50 },
  ],
  [
    { x: 0, y: 100 },
    { x: 0, y: 0 },
    { x: 8, y: 50 },
  ],
])(
  "keeps an inline Label on the standard side after drawing from %j to %j",
  (from, to, expected) => {
    const project = createEmptyProject("label-look", "Label look");
    const document = project.documents[0]!;
    const resolver = createProjectSymbolResolver(project, builtInSymbols);
    const wire = proposeWireCommit(
      prepareNamedWireSource(createFreeWireAnchor(from, "n", true, "a"), "CLK"),
      createFreeWireAnchor(to, "n", false, "b"),
      [],
      1,
    );
    const result = executeProjectTransaction(project, {
      transactionId: "draw",
      projectId: project.id,
      expectedStructureRevision: 0,
      actor: { kind: "human", id: "test" },
      edits: [
        {
          kind: "transact_document",
          documentId: document.id,
          expectedRevision: 0,
          edits: planNamedWireEdits(
            document,
            wire.edits,
            wire.routeId,
            {
              name: "CLK",
              content: semanticTextDocument("CLK", "net-label"),
              sizeScale: 1,
              alignment: "start",
              position: from,
            },
            { symbolResolver: resolver },
          ),
        },
      ],
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    const saved = parseProject(serializeProject(result.project)).documents[0]!;
    expect(
      resolveVisualAnchor(saved, resolver, saved.annotations[0]!.anchor),
    ).toMatchObject({
      resolved: true,
      position: expected,
      rotation: 0,
    });
  },
);

it.each([
  "DATA<1,1>",
  "CLK,CLK",
  "DATA<3:0>,DATA<2>",
  "CLK,clk",
  "DATA<1>,data<1>",
])(
  "rejects duplicate members before accepting inline name %s",
  (expression) => {
    const source = createFreeWireAnchor({ x: 0, y: 0 }, "n", true, "a");
    expect(() => prepareNamedWireSource(source, expression)).toThrow(
      /unique|duplicate/i,
    );
  },
);

it("commits a loose Wire and its mixed scalar bundle name atomically through Project editing", () => {
  const project = createEmptyProject("named-wire", "Named Wire");
  const document = project.documents[0]!;
  const source = prepareNamedWireSource(
    createFreeWireAnchor({ x: 0, y: 0 }, "source", true, "start"),
    "CLK,RESET",
  );
  const proposal = proposeWireCommit(
    source,
    createFreeWireAnchor({ x: 100, y: 100 }, "end", true, "end"),
    [{ x: 100, y: 0 }],
    { routeId: "wire", newNetId: "net" },
  );
  const edits = planNamedWireEdits(
    document,
    proposal.edits,
    proposal.routeId,
    {
      name: "CLK,RESET",
      content: semanticTextDocument("CLK,RESET", "net-label"),
      sizeScale: 1,
      alignment: "start",
      position: { x: 40, y: -10 },
    },
    { symbolResolver: createProjectSymbolResolver(project, builtInSymbols) },
  );
  const result = executeProjectTransaction(project, {
    transactionId: "draw",
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    actor: { kind: "human", id: "test" },
    edits: [
      {
        kind: "transact_document",
        documentId: document.id,
        expectedRevision: document.revision,
        edits,
      },
    ],
  });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) return;
  const saved = parseProject(serializeProject(result.project)).documents[0]!;
  expect(saved.routes[0]!.members).toHaveLength(2);
  expect(
    saved.connectivityEvidence.find((claim) => claim.kind === "name-claim"),
  ).toMatchObject({
    signal: {
      expression: "CLK,RESET",
      members: [{ name: "CLK" }, { name: "RESET" }],
    },
  });
});

it("names an already drawn loose scalar path with a scalar-only bundle without treating the comma as a literal", () => {
  const project = createEmptyProject("bundle-label", "Bundle Label");
  const document = project.documents[0]!;
  const wire = proposeWireCommit(
    createFreeWireAnchor({ x: 0, y: 0 }, "n", true, "a"),
    createFreeWireAnchor({ x: 100, y: 0 }, "n", false, "b"),
    [],
    1,
  );
  const drawn = executeProjectTransaction(project, {
    transactionId: "draw",
    projectId: project.id,
    expectedStructureRevision: 0,
    actor: { kind: "human", id: "test" },
    edits: [
      {
        kind: "transact_document",
        documentId: document.id,
        expectedRevision: 0,
        edits: wire.edits,
      },
    ],
  });
  expect(drawn.ok).toBe(true);
  if (!drawn.ok) return;
  const cell = drawn.project.documents[0]!;
  const naming = planEnsureNamedRoute(cell, wire.routeId, {
    name: "CLK,RESET",
    candidateNetId: cell.routes[0]!.netId,
    evidenceId: "name",
    owner: { kind: "net-label", annotationId: "label" },
  });
  expect(naming.ok).toBe(true);
  if (!naming.ok) return;
  const named = executeProjectTransaction(drawn.project, {
    transactionId: "name",
    projectId: project.id,
    expectedStructureRevision: drawn.project.structureRevision,
    actor: { kind: "human", id: "test" },
    edits: [
      {
        kind: "transact_document",
        documentId: cell.id,
        expectedRevision: cell.revision,
        edits: [
          ...naming.edits,
          {
            kind: "upsert_schematic_annotation",
            annotation: {
              id: "label",
              kind: "net-label",
              netId: naming.netId,
              binding: { kind: "net-name", netId: naming.netId },
              anchor: { kind: "free", position: { x: 50, y: -10 } },
              alignment: "start",
              rotation: 0,
              locked: false,
            },
          },
        ],
      },
    ],
  });
  expect(named.ok, JSON.stringify(named)).toBe(true);
  if (!named.ok) return;
  const reopened = parseProject(serializeProject(named.project)).documents[0]!;
  expect(reopened.routes[0]!.members).toHaveLength(2);
  expect(
    reopened.connectivityEvidence.find((claim) => claim.kind === "name-claim"),
  ).toMatchObject({
    signal: {
      expression: "CLK,RESET",
      members: [{ name: "CLK" }, { name: "RESET" }],
    },
  });
});

it("names a scalar continuation in the same transaction even when collinear geometry coalesces", () => {
  const project = createEmptyProject("continued-name", "Continued name");
  const document = project.documents[0]!;
  const wire = proposeWireCommit(
    createFreeWireAnchor({ x: 0, y: 0 }, "n", true, "a"),
    createFreeWireAnchor({ x: 100, y: 0 }, "n", false, "b"),
    [],
    1,
  );
  const drawn = executeProjectTransaction(project, {
    transactionId: "draw",
    projectId: project.id,
    expectedStructureRevision: 0,
    actor: { kind: "human", id: "test" },
    edits: [
      {
        kind: "transact_document",
        documentId: document.id,
        expectedRevision: 0,
        edits: wire.edits,
      },
    ],
  });
  expect(drawn.ok).toBe(true);
  if (!drawn.ok) return;
  const cell = drawn.project.documents[0]!;
  const from = {
    ...createFreeWireAnchor(
      { x: 100, y: 0 },
      cell.routes[0]!.netId,
      false,
      "b",
    ),
    preludeEdits: [],
  };
  const continued = proposeWireCommit(
    from,
    createFreeWireAnchor({ x: 200, y: 0 }, cell.routes[0]!.netId, false, "c"),
    [],
    2,
  );
  const edits = planNamedWireEdits(
    cell,
    continued.edits,
    continued.routeId,
    {
      name: "CONTINUED",
      content: semanticTextDocument("CONTINUED", "net-label"),
      sizeScale: 1,
      alignment: "start",
      position: { x: 150, y: -10 },
    },
    {
      symbolResolver: createProjectSymbolResolver(
        drawn.project,
        builtInSymbols,
      ),
    },
  );
  const result = executeProjectTransaction(drawn.project, {
    transactionId: "continue",
    projectId: project.id,
    expectedStructureRevision: drawn.project.structureRevision,
    actor: { kind: "human", id: "test" },
    edits: [
      {
        kind: "transact_document",
        documentId: cell.id,
        expectedRevision: cell.revision,
        edits,
      },
    ],
  });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) return;
  const final = parseProject(serializeProject(result.project)).documents[0]!;
  expect(
    final.connectivityEvidence.find((claim) => claim.kind === "name-claim"),
  ).toMatchObject({ name: "CONTINUED" });
  expect(final.nets).toHaveLength(1);
  expect(final.annotations).toHaveLength(1);
});
