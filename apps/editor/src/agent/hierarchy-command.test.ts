import { createEmptyDocument, createEmptyProject } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import {
  executeProjectTransaction,
  planRenameCellTerminal,
  planRemoveCellTerminal,
} from "@icm/edit-engine";
import { AgentAuthoringCommandSchema } from "@icm/agent-adapter";
import { expect, it } from "vitest";
import { planBrowserAgentCommand } from "./browser-agent-command";

it("creates a Cell from a pinned Cell without inheriting foreign pin placements", () => {
  const project = createEmptyProject("p", "Project");
  const source = project.documents[0]!;
  source.presentation.grid = 20;
  source.instances.push({ id: "P1", symbolId: "port", placement: null });
  source.nets.push({
    id: "net-in",
    terminals: [{ instanceId: "P1", pinName: "P" }],
  });
  source.netlist!.terminals.push({
    id: "old-terminal",
    name: "IN",
    netId: "net-in",
    direction: "input",
    interfaceInstanceIds: ["P1"],
  });
  source.presentation.cellSymbol = {
    pinPlacements: [{ terminalId: "old-terminal", side: "west", offset: 0 }],
  };
  const resolver = new InMemorySymbolResolver(builtInSymbols);
  const plan = planBrowserAgentCommand(project, source.id, resolver, {
    kind: "create-cell",
    id: "new-cell",
    name: "New Cell",
  });
  if (!("structureEdits" in plan)) throw new Error("expected structure edits");
  expect(plan.structureEdits).toMatchObject([
    {
      kind: "add_document",
      document: {
        id: "new-cell",
        presentation: { grid: 20 },
        netlist: { terminals: [] },
      },
    },
  ]);
  const first = plan.structureEdits?.[0];
  expect(first?.kind).toBe("add_document");
  if (first?.kind !== "add_document") return;
  expect(first.document.presentation.cellSymbol).toBeUndefined();
  expect(
    executeProjectTransaction(project, {
      transactionId: "agent-create-cell-test",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "agent", id: "test" },
      edits: plan.structureEdits!,
    }).ok,
  ).toBe(true);
});

it.each([false, true])(
  "passes explicit Port merge intent to the shared planner (%s)",
  (mergeExistingPort) => {
    const project = createEmptyProject("p", "Project");
    const child = createEmptyDocument("child", "Child");
    project.documents.push(child);
    for (const name of ["A", "B"]) {
      child.instances.push({ id: name, symbolId: "port", placement: null });
      child.nets.push({
        id: `n-${name}`,
        terminals: [{ instanceId: name, pinName: "P" }],
      });
      child.netlist!.terminals.push({
        id: name,
        name,
        netId: `n-${name}`,
        direction: "input",
        interfaceInstanceIds: [name],
      });
    }
    const parent = project.documents[0]!;
    parent.instances.push({
      id: "X1",
      reference: "X1",
      symbolId: "cell:Child",
      placement: null,
      netlist: {
        binding: { kind: "subcircuit", childDocumentId: child.id },
        parameters: {},
      },
    });
    for (const name of ["A", "B"])
      parent.nets.push({
        id: `parent-${name}`,
        terminals: [{ instanceId: "X1", pinName: name }],
      });
    const resolver = new InMemorySymbolResolver(builtInSymbols);
    const before = structuredClone(project);
    expect(
      planBrowserAgentCommand(project, child.id, resolver, {
        kind: "rename-cell-terminal",
        terminalId: "A",
        name: "B",
        mergeExistingPort,
      }),
    ).toEqual({
      structureEdits: planRenameCellTerminal(project, child.id, "A", "B", {
        mergeExistingPort,
      }),
    });
    expect(
      planBrowserAgentCommand(project, child.id, resolver, {
        kind: "remove-cell-terminal",
        terminalId: "A",
      }),
    ).toEqual({
      structureEdits: planRemoveCellTerminal(project, child.id, "A"),
    });
    expect(project).toEqual(before);
  },
);

it("uses the shared parameter planner across child fields and caller overrides", () => {
  let project = createEmptyProject("p", "Project");
  const child = createEmptyDocument("child", "Child");
  child.netlist = { name: "Child", terminals: [], formalParameters: [] };
  child.instances.push({
    id: "R1",
    symbolId: "resistor",
    reference: "R1",
    placement: null,
    netlist: { parameters: { value: "1k" } },
  });
  project.documents.push(child);
  project.documents[0]!.instances.push({
    id: "X1",
    reference: "X1",
    symbolId: "cell:Child",
    placement: null,
    netlist: {
      binding: { kind: "subcircuit", childDocumentId: "child" },
      parameters: {},
    },
  });
  const resolver = new InMemorySymbolResolver(builtInSymbols);
  const apply = (command: unknown) => {
    const plan = planBrowserAgentCommand(
      project,
      "child",
      resolver,
      AgentAuthoringCommandSchema.parse(command),
    );
    if (!("structureEdits" in plan))
      throw new Error("Expected structural plan");
    const result = executeProjectTransaction(project, {
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      transactionId: "agent",
      actor: { kind: "agent", id: "test" },
      edits: [...plan.structureEdits],
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) project = result.project;
  };
  apply({
    kind: "bind-cell-parameter",
    instanceId: "R1",
    field: "value",
    name: "r",
    defaultValue: "1k",
  });
  project.documents[0]!.instances[0]!.netlist!.parameters.r = "2k";
  apply({ kind: "rename-cell-parameter", oldName: "r", newName: "res" });
  expect(project.documents[0]!.instances[0]!.netlist!.parameters).toEqual({
    res: "2k",
  });
  expect(project.documents[1]!.instances[0]!.netlist!.parameters.value).toBe(
    "{res}",
  );
  apply({
    kind: "set-cell-parameter-default",
    name: "res",
    defaultValue: "3k",
  });
  expect(project.documents[1]!.netlist!.formalParameters).toEqual([
    { name: "res", defaultValue: "3k" },
  ]);
  const before = structuredClone(project);
  expect(() => apply({ kind: "remove-cell-parameter", name: "res" })).toThrow(
    /still referenced/,
  );
  expect(project).toEqual(before);
});
