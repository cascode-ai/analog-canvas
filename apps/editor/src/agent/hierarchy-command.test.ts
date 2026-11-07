import { createEmptyDocument, createEmptyProject } from "@icm/model";
import { readFileSync } from "node:fs";
import { parseProject, serializeProject } from "@icm/project-protocol";
import { planProjectCodeCommit } from "../features/project-code/project-code";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { executeProjectTransaction } from "@icm/edit-engine";
import { AgentAuthoringCommandSchema } from "@icm/agent-adapter";
import { expect, it } from "vitest";
import { planBrowserAgentCommand } from "./browser-agent-command";
import { liveAgentEditor } from "./live-agent-editor.test-support";
import { hierarchyNavigationFixture } from "../../../../netlists/hierarchy-navigation/fixture";

it.each(["INPUT", "INPUT".repeat(30)])(
  "authors and renames vector Cell Pins through the live Agent service (%s)",
  (baseName) => {
    const { controller, service } = liveAgentEditor();
    const created = service.handle({
      apiVersion: "3.0",
      requestId: "create-bus",
      transactionId: "create-bus",
      operation: "transact",
      documentId: "main",
      expectedRevision: 0,
      expectedStructureRevision: controller.project.structureRevision,
      actions: [
        {
          kind: "place-component",
          symbol: "port",
          reference: "DATA<0:3>",
          direction: "input",
          position: { x: 100, y: 100 },
        },
      ],
    });
    expect(created.ok, JSON.stringify(created)).toBe(true);
    const read = service.handle({
      apiVersion: "3.0",
      requestId: "read-bus",
      operation: "snapshot",
      documentId: "main",
    });
    expect(read.ok, JSON.stringify(read)).toBe(true);
    if (!read.ok || read.operation !== "snapshot" || !("snapshot" in read))
      return;
    const terminal = read.snapshot.document.cellInterface!.terminals[0]!;
    expect(terminal.signal?.members.map((member) => member.name)).toEqual([
      "DATA<0>",
      "DATA<1>",
      "DATA<2>",
      "DATA<3>",
    ]);
    expect(
      read.snapshot.document.nets
        .map((net) => net.terminals[0]?.memberId)
        .filter(Boolean),
    ).toHaveLength(4);
    const before = structuredClone(controller.project);
    const invalid = service.handle({
      apiVersion: "3.0",
      requestId: "invalid-bus",
      transactionId: "invalid-bus",
      operation: "transact",
      documentId: "main",
      expectedRevision: controller.document.revision,
      expectedStructureRevision: controller.project.structureRevision,
      command: {
        kind: "rename-cell-terminal",
        terminalId: terminal.id,
        name: "DATA<3:>",
      },
    });
    expect(invalid.ok).toBe(false);
    expect(controller.project).toEqual(before);
    const migrated = service.handle({
      apiVersion: "3.0",
      requestId: "migrate-bus",
      transactionId: "migrate-bus",
      operation: "transact",
      documentId: "main",
      expectedRevision: controller.document.revision,
      expectedStructureRevision: controller.project.structureRevision,
      command: {
        kind: "rename-cell-terminal",
        terminalId: terminal.id,
        name: `${baseName}<3:0>`,
        memberMap: Object.fromEntries(
          terminal.signal!.members.map((member) => [
            member.id,
            member.name.replace("DATA", baseName),
          ]),
        ),
      },
    });
    if (baseName.length > 128) {
      expect(migrated.ok).toBe(false);
      expect(controller.project).toEqual(before);
      return;
    }
    expect(migrated.ok, JSON.stringify(migrated)).toBe(true);
    if (migrated.ok && migrated.operation === "transact")
      expect(migrated.diff.changedObjectIds).toContain(
        terminal.interfaceInstanceIds[0],
      );
    expect(
      controller.document.netlist!.terminals[0]!.signal!.members.map(
        (member) => member.id,
      ),
    ).toEqual(
      [...terminal.signal!.members].reverse().map((member) => member.id),
    );
    const beforePermutation = structuredClone(controller.document);
    const members = beforePermutation.netlist!.terminals[0]!.signal!.members;
    const permutation = service.handle({
      apiVersion: "3.0",
      requestId: "permute-bus",
      transactionId: "permute-bus",
      operation: "transact",
      documentId: "main",
      expectedRevision: controller.document.revision,
      expectedStructureRevision: controller.project.structureRevision,
      command: {
        kind: "rename-cell-terminal",
        terminalId: terminal.id,
        name: `${baseName}<3:0>`,
        memberMap: Object.fromEntries(
          members.map((member, index) => [member.id, members[3 - index]!.name]),
        ),
      },
    });
    expect(permutation.ok, JSON.stringify(permutation)).toBe(true);
    const reopened = parseProject(serializeProject(controller.project))
      .documents[0]!;
    expect(reopened.netlist!.terminals[0]!.name).toBe(`${baseName}<3:0>`);
    expect(
      reopened.netlist!.terminals[0]!.signal!.members.map(
        (member) => member.id,
      ),
    ).toEqual([...members].reverse().map((member) => member.id));
    for (const member of members)
      expect(
        reopened.nets.find((net) => net.id === member.netId)?.terminals,
      ).toContainEqual({
        instanceId: terminal.interfaceInstanceIds[0],
        pinName: "P",
        memberId: member.id,
      });
    expect(controller.transact([{ kind: "undo" }]).ok).toBe(true);
    expect({
      ...controller.document,
      revision: beforePermutation.revision,
    }).toEqual(beforePermutation);
    const undo = controller.transact([{ kind: "undo" }]);
    expect(undo.ok, JSON.stringify(undo)).toBe(true);
    expect({
      ...controller.document,
      revision: before.documents[0]!.revision,
    }).toEqual(before.documents[0]);
  },
);

it.each([
  ["range-formal", "DATA<1>"],
  ["bundle-formal", "CLK"],
])(
  "deliberately converts legacy %s through Agent and Project Code with one Undo",
  (terminalId, target) => {
    const project = parseProject(
      readFileSync(
        "fixtures/projects/legacy-scalar-signals/project.icproj.json",
        "utf8",
      ),
    );
    const { controller, service } = liveAgentEditor({ project });
    const terminal = controller.document.netlist!.terminals.find(
      (item) => item.id === terminalId,
    )!;
    const before = structuredClone(controller.project);
    const request = {
      apiVersion: "3.0" as const,
      operation: "transact" as const,
      documentId: "main",
      expectedRevision: controller.document.revision,
      expectedStructureRevision: controller.project.structureRevision,
      command: {
        kind: "rename-cell-terminal" as const,
        terminalId,
        name: terminal.name,
        convertLegacy: true,
      },
    };
    const rejected = service.handle({
      ...request,
      requestId: "unmapped",
      transactionId: "unmapped",
    });
    expect(rejected.ok).toBe(false);
    expect(controller.project).toEqual(before);
    const converted = service.handle({
      ...request,
      requestId: "convert",
      transactionId: "convert",
      command: { ...request.command, memberMap: { [terminalId]: target } },
    });
    expect(converted.ok, JSON.stringify(converted)).toBe(true);
    const after = controller.document.netlist!.terminals.find(
      (item) => item.id === terminalId,
    )!;
    expect(
      after.signal!.members.find((member) => member.id === terminalId),
    ).toEqual({ id: terminalId, name: target, netId: terminal.netId });
    const code = planProjectCodeCommit(
      controller.project,
      serializeProject(controller.project),
      "main",
    );
    expect(code.ok).toBe(true);
    if (code.ok)
      expect(
        parseProject(serializeProject(code.project)).documents[0]!.netlist!
          .terminals,
      ).toEqual(controller.document.netlist!.terminals);
    expect(controller.transact([{ kind: "undo" }]).ok).toBe(true);
    expect({
      ...controller.document,
      revision: before.documents[0]!.revision,
    }).toEqual(before.documents[0]);
  },
);

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

it("reshapes the hierarchy through the live Agent service, one undo each", () => {
  const { controller, service } = liveAgentEditor({
    project: hierarchyNavigationFixture(),
  });
  let step = 0;
  /** Transact `actions` in `documentId`; the result, which must be ok. */
  const act = (documentId: string, actions: unknown[]) => {
    const document = controller.project.documents.find(
      (cell) => cell.id === documentId,
    )!;
    const result = service.handle({
      apiVersion: "3.0",
      requestId: `reshape-${++step}`,
      transactionId: `reshape-${step}`,
      operation: "transact",
      documentId,
      expectedRevision: document.revision,
      expectedStructureRevision: controller.project.structureRevision,
      actions,
    } as never);
    expect(result.ok, JSON.stringify(result).slice(0, 600)).toBe(true);
  };
  const binding = (documentId: string, instanceId: string) =>
    controller.project.documents
      .find((cell) => cell.id === documentId)!
      .instances.find((item) => item.id === instanceId)?.netlist?.binding;
  const cells = () => controller.project.documents.map((cell) => cell.id);

  act("top", [{ kind: "set-top-cell", id: "unused" }]);
  expect(controller.project.topDocumentId).toBe("unused");

  act("top", [
    { kind: "make-unique-cell", instanceId: "X1", id: "channel-x1" },
  ]);
  expect(binding("top", "X1")).toEqual({
    kind: "subcircuit",
    childDocumentId: "channel-x1",
  });
  expect(
    controller.project.documents.find((cell) => cell.id === "channel-x1")?.name,
  ).toBe("Channel_2");

  act("top", [
    {
      kind: "replace-cell",
      instanceIds: ["X1"],
      replacementId: "channel",
      allUses: true,
    },
  ]);
  expect(binding("top", "X1")).toMatchObject({ childDocumentId: "channel" });

  act("amplifier", [{ kind: "flatten-instance", instanceId: "XP" }]);
  const amplifier = controller.project.documents.find(
    (cell) => cell.id === "amplifier",
  )!;
  expect(amplifier.instances.some((item) => item.id === "XP")).toBe(false);
  const resistor = amplifier.instances.find(
    (item) => item.symbolId === "resistor",
  )!;
  expect(resistor.netlist?.parameters).toEqual({ value: "{gain}" });

  act("amplifier", [
    {
      kind: "cell-from-selection",
      instanceIds: [resistor.id],
      id: "wrap",
      name: "Wrap",
    },
  ]);
  expect(cells()).toContain("wrap");
  expect(
    controller.project.documents
      .find((cell) => cell.id === "wrap")!
      .netlist!.terminals.map((pin) => pin.name),
  ).toEqual(["IN", "OUT"]);

  // Each is one step back, undone from the Cell it edited.
  for (const [documentId, expected] of [
    ["amplifier", () => expect(cells()).not.toContain("wrap")],
    [
      "amplifier",
      () =>
        expect(
          controller.project.documents
            .find((cell) => cell.id === "amplifier")!
            .instances.some((item) => item.id === "XP"),
        ).toBe(true),
    ],
    [
      "top",
      () =>
        expect(binding("top", "X1")).toMatchObject({
          childDocumentId: "channel-x1",
        }),
    ],
    [
      "top",
      () =>
        expect(binding("top", "X1")).toMatchObject({
          childDocumentId: "channel",
        }),
    ],
    ["top", () => expect(controller.project.topDocumentId).toBe("top")],
  ] as const) {
    act(documentId, [{ kind: "undo" }]);
    expected();
  }
});

it("refuses what the tree refuses: a split coupling, a cycle and an unknown Top", () => {
  const { controller, service } = liveAgentEditor({
    project: hierarchyNavigationFixture(),
  });
  const run = (documentId: string, actions: unknown[]) =>
    service.handle({
      apiVersion: "3.0",
      requestId: "refuse",
      transactionId: "refuse",
      operation: "transact",
      documentId,
      expectedRevision: controller.project.documents.find(
        (cell) => cell.id === documentId,
      )!.revision,
      expectedStructureRevision: controller.project.structureRevision,
      actions,
    } as never);
  const before = structuredClone(controller.project);
  for (const [documentId, actions, message] of [
    [
      "top",
      [{ kind: "set-top-cell", id: "missing" }],
      /Cell not found: missing/u,
    ],
    [
      "channel",
      [{ kind: "replace-cell", instanceIds: ["XA"], replacementId: "channel" }],
      /cannot contain itself/u,
    ],
    [
      "pair",
      [
        {
          kind: "cell-from-selection",
          instanceIds: ["P_IN"],
          id: "x",
          name: "X",
        },
      ],
      /Select the parts to move into the new Cell/u,
    ],
  ] as const) {
    const result = run(documentId, [...actions]);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).toMatch(message);
  }
  expect(controller.project).toEqual(before);
});
