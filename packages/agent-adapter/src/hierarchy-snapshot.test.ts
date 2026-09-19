import { createEmptyDocument, createEmptyProject } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { expect, it } from "vitest";
import { buildAgentSessionSnapshot } from "./snapshot.js";

it("preserves Cell order and distinguishes structural calls from matching names without wires", () => {
  const project = createEmptyProject("p", "Project", "z-top");
  const child = createEmptyDocument("a-child", "Child");
  child.netlist = { name: "Child", terminals: [], formalParameters: [] };
  project.documents.push(child);
  const parent = project.documents[0]!;
  parent.instances.push(
    {
      id: "internal",
      symbolId: "cell:Child",
      placement: null,
      netlist: {
        binding: { kind: "subcircuit", childDocumentId: child.id },
        parameters: {},
      },
    },
    {
      id: "unresolved",
      symbolId: "cell:Child",
      placement: null,
      netlist: {
        binding: { kind: "unresolved-subcircuit", name: "Child" },
        parameters: {},
      },
    },
    {
      id: "external",
      symbolId: "cell:Child",
      placement: null,
      netlist: {
        binding: { kind: "external-subcircuit", definitionId: "Child" },
        parameters: {},
      },
    },
  );
  const snapshot = buildAgentSessionSnapshot({
    project,
    document: parent,
    resolver: new InMemorySymbolResolver(builtInSymbols),
  });
  expect(snapshot.project.documents.map((cell) => cell.id)).toEqual([
    "z-top",
    "a-child",
  ]);
  expect(snapshot.project.topDocumentId).toBe("z-top");
  expect(snapshot.project.documents[0]!.references).toEqual([
    {
      instanceId: "external",
      targetKind: "external",
      targetName: "Child",
      targetDefinitionId: "Child",
      targetDocumentId: null,
    },
    {
      instanceId: "internal",
      targetKind: "internal",
      targetName: "Child",
      targetDefinitionId: null,
      targetDocumentId: "a-child",
    },
    {
      instanceId: "unresolved",
      targetKind: "unresolved",
      targetName: "Child",
      targetDefinitionId: null,
      targetDocumentId: null,
    },
  ]);
});
