import { expect, it } from "vitest";
import {
  createEmptyProject,
  createEmptyDocument,
  flattenRichText,
} from "@icm/model";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  hierarchicalSymbolId,
} from "@icm/symbols";
import { parseProject, serializeProject } from "@icm/project-protocol";
import {
  resolveAnnotationText,
  resolveAnnotationName,
  resolveDocumentLogicalNets,
} from "@icm/derived";
import { renderDocumentSvg } from "@icm/render-svg";
import { executeProjectTransaction } from "./project-transaction.js";
import { planCreateCellPin } from "./cell-pin-planner.js";
import { proposeWireIntent } from "./wire-intent-planner.js";

it("displays an unnamed caller's selected formal member without creating a parent name", () => {
  const initial = createEmptyProject("selector", "Selector", "child");
  const created = executeProjectTransaction(initial, {
    transactionId: "pin",
    projectId: initial.id,
    expectedStructureRevision: 0,
    actor: { kind: "human", id: "test" },
    edits: planCreateCellPin(initial, "child", {
      instance: {
        id: "port",
        symbolId: "port",
        placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      },
      terminal: {
        id: "formal",
        name: "INPUT<7:4>",
        netId: "input",
        direction: "input",
        interfaceInstanceIds: ["port"],
      },
      connectionEdits: [],
      signalExpression: "INPUT<7:4>",
    }),
  });
  expect(created.ok, JSON.stringify(created)).toBe(true);
  if (!created.ok) return;
  const parent = createEmptyDocument("parent", "Parent");
  const child = created.project.documents[0]!;
  parent.instances.push({
    id: "call",
    reference: "X1",
    symbolId: hierarchicalSymbolId(child.netlist!.name),
    placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    netlist: {
      binding: { kind: "subcircuit", childDocumentId: child.id },
      parameters: {},
    },
  });
  const project = {
    ...created.project,
    topDocumentId: parent.id,
    documents: [...created.project.documents, parent],
  };
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  const proposal = proposeWireIntent(parent, resolver, {
    id: "tap",
    from: {
      kind: "endpoint",
      endpoint: {
        kind: "terminal",
        instanceId: "call",
        pinName: "INPUT<7:4>",
        memberId: child.netlist!.terminals[0]!.signal!.members[1]!.id,
      },
    },
    to: { kind: "free", point: { x: -200, y: -40 } },
  });
  if (typeof proposal === "string") throw new Error(proposal);
  const result = executeProjectTransaction(project, {
    transactionId: "tap",
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    actor: { kind: "human", id: "test" },
    edits: [
      {
        kind: "transact_document",
        documentId: parent.id,
        expectedRevision: parent.revision,
        edits: proposal.edits,
      },
    ],
  });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) return;
  const reopened = parseProject(serializeProject(result.project));
  const document = reopened.documents.find((item) => item.id === parent.id)!;
  const displayResolver = createProjectSymbolResolver(reopened, builtInSymbols);
  const selector = document.annotations.find(
    (item) => item.id === "tap-route-selector",
  )!;
  const locked = executeProjectTransaction(reopened, {
    transactionId: "lock-selector",
    projectId: reopened.id,
    expectedStructureRevision: reopened.structureRevision,
    actor: { kind: "human", id: "test" },
    edits: [
      {
        kind: "transact_document",
        documentId: document.id,
        expectedRevision: document.revision,
        edits: [
          {
            kind: "upsert_schematic_annotation",
            annotation: { ...selector, locked: true },
          },
        ],
      },
    ],
  });
  expect(locked.ok, JSON.stringify(locked)).toBe(true);
  if (!locked.ok) return;
  const lockedDocument = locked.project.documents.find(
    (item) => item.id === document.id,
  )!;
  const cut = executeProjectTransaction(locked.project, {
    transactionId: "cut-locked-selector",
    projectId: reopened.id,
    expectedStructureRevision: locked.project.structureRevision,
    actor: { kind: "human", id: "test" },
    edits: [
      {
        kind: "transact_document",
        documentId: document.id,
        expectedRevision: lockedDocument.revision,
        edits: [{ kind: "cut_connection", routeId: "tap-route" }],
      },
    ],
  });
  expect(cut.ok).toBe(false);
  expect(cut.project).toEqual(locked.project);
  expect(selector.binding).toMatchObject({
    kind: "net-name",
    memberEndpoint: {
      kind: "terminal",
      instanceId: "call",
      pinName: "INPUT<7:4>",
      memberId: child.netlist!.terminals[0]!.signal!.members[1]!.id,
    },
  });
  expect(document.connectivityEvidence).toEqual([]);
  expect(resolveAnnotationName(document, selector)).toBe("");
  expect(
    resolveDocumentLogicalNets(document).groups.every(
      (net) => net.name === undefined,
    ),
  ).toBe(true);
  expect(
    flattenRichText(
      resolveAnnotationText(document, selector, undefined, displayResolver),
    ),
  ).toBe("INPUT<6>");
  expect(renderDocumentSvg(document, displayResolver)).toMatch(
    /data-object-id="tap-route-selector"[\s\S]*?INPUT/u,
  );
  const styled = executeProjectTransaction(reopened, {
    transactionId: "style-selector",
    projectId: reopened.id,
    expectedStructureRevision: reopened.structureRevision,
    actor: { kind: "human", id: "test" },
    edits: [
      {
        kind: "transact_document",
        documentId: document.id,
        expectedRevision: document.revision,
        edits: [
          {
            kind: "upsert_schematic_annotation",
            annotation: {
              ...selector,
              formatOverride: {
                runs: [
                  {
                    kind: "span",
                    style: "bold",
                    children: [{ kind: "text", value: "INPUT<6>" }],
                  },
                ],
              },
            },
          },
        ],
      },
    ],
  });
  expect(styled.ok, JSON.stringify(styled)).toBe(true);
  if (!styled.ok) return;
  const styledProject = parseProject(serializeProject(styled.project));
  const styledDocument = styledProject.documents.find(
    (item) => item.id === document.id,
  )!;
  expect(
    styledDocument.annotations.find((item) => item.id === selector.id)
      ?.formatOverride,
  ).toEqual({
    runs: [
      {
        kind: "span",
        style: "bold",
        children: [{ kind: "text", value: "INPUT<6>" }],
      },
    ],
  });
  const continuation = proposeWireIntent(
    styledDocument,
    createProjectSymbolResolver(styledProject, builtInSymbols),
    {
      id: "whole-after-tap",
      from: {
        kind: "endpoint",
        endpoint: {
          kind: "terminal",
          instanceId: "call",
          pinName: "INPUT<7:4>",
        },
      },
      to: { kind: "free", point: { x: -80, y: 160 } },
    },
  );
  if (typeof continuation === "string") throw new Error(continuation);
  const continued = executeProjectTransaction(styledProject, {
    transactionId: "whole-after-tap",
    projectId: styledProject.id,
    expectedStructureRevision: styledProject.structureRevision,
    actor: { kind: "human", id: "test" },
    edits: [
      {
        kind: "transact_document",
        documentId: styledDocument.id,
        expectedRevision: styledDocument.revision,
        edits: continuation.edits,
      },
    ],
  });
  expect(continued.ok, JSON.stringify(continued)).toBe(true);
  if (continued.ok) {
    const parent = continued.project.documents.find(
      (item) => item.id === styledDocument.id,
    )!;
    expect(parent.routes.find((route) => route.members)?.members).toHaveLength(
      4,
    );
    expect(parent.nets).toHaveLength(4);
    expect(parent.connectivityEvidence).toEqual([]);
    const trunk = parent.routes.find((route) => route.members)!;
    const tap = parent.routes.find((route) => route.id === "tap-route")!;
    expect(new Set(trunk.members!.map((member) => member.netId)).size).toBe(4);
    expect(trunk.members![1]!.netId).toBe(tap.netId);
    expect(tap.netId).toBe(document.routes[0]!.netId);
    expect(parseProject(serializeProject(continued.project))).toEqual(
      continued.project,
    );
  }
  const stale = {
    ...selector,
    formatOverride: { runs: [{ kind: "text" as const, value: "WRONG" }] },
  };
  expect(
    flattenRichText(
      resolveAnnotationText(document, stale, undefined, displayResolver),
    ),
  ).toBe("INPUT<6>");
});
