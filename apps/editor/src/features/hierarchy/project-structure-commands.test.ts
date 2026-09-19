import type { ProjectStructureEdit } from "@icm/edit-engine";
import { createEmptyDocument, createEmptyProject } from "@icm/model";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { describe, expect, it, vi } from "vitest";

import {
  createProjectStructureCommands,
  applyConfirmedCellInterfaceEdit,
} from "./project-structure-commands";
import type { CellInterfaceConfirmation } from "./project-structure-commands";
import { localBlockSymbolTarget } from "./block-symbol-layout-target";

function dependencies() {
  const project = createEmptyProject("project", "Project");
  const commitStructure = vi.fn<
    (
      transactionId: string,
      edits: ProjectStructureEdit[],
      activeDocumentId?: string,
    ) => boolean
  >(() => true);
  return {
    project,
    activeDocument: project.documents[0]!,
    resolver: createProjectSymbolResolver(project, builtInSymbols),
    commitStructure,
    setStatus: vi.fn(),
    onCellCreated: vi.fn(),
    nextSequence: vi.fn(() => 1),
    createDocumentId: vi.fn(() => "document-child"),
  };
}

describe("Project structure commands", () => {
  it("never applies a confirmation against a replaced Project snapshot", () => {
    const project = createEmptyProject("project", "Project");
    const request = {
      title: "Delete",
      message: "Delete Port",
      confirmLabel: "Delete",
      apply: vi.fn(() => true),
    };
    expect(() =>
      applyConfirmedCellInterfaceEdit(
        request,
        project,
        structuredClone(project),
      ),
    ).toThrow("Project changed");
    expect(request.apply).not.toHaveBeenCalled();
    expect(applyConfirmedCellInterfaceEdit(request, project, project)).toBe(
      true,
    );
    expect(request.apply).toHaveBeenCalledTimes(1);
  });
  it("deletes only unused external definitions and preserves failure feedback", () => {
    const input = dependencies();
    input.project.externalSubcircuitDefinitions.push({
      id: "ext",
      name: "Amp",
      terminals: [],
      formalParameters: [],
      interfaceStatus: "declared",
    });
    const commands = createProjectStructureCommands(input);
    input.activeDocument.instances.push({
      id: "X1",
      symbolId: "block",
      placement: null,
      netlist: {
        parameters: {},
        binding: { kind: "external-subcircuit", definitionId: "ext" },
      },
    });
    expect(commands.removeExternalSubcircuitDefinition("ext")).toMatchObject({
      ok: false,
      message: expect.stringContaining("X1"),
    });
    expect(input.commitStructure).not.toHaveBeenCalled();
    input.activeDocument.instances = [];
    expect(commands.removeExternalSubcircuitDefinition("ext").ok).toBe(true);
    expect(input.commitStructure).toHaveBeenCalledWith(
      "remove-external-subcircuit-definition",
      [{ kind: "remove_external_subcircuit_definition", definitionId: "ext" }],
    );
    input.commitStructure.mockReturnValue(false);
    expect(commands.removeExternalSubcircuitDefinition("ext").ok).toBe(false);
    expect(commands.removeExternalSubcircuitDefinition("missing").ok).toBe(
      false,
    );
  });

  it("defers connected deletion and electrical merging until internal confirmation", () => {
    const input = dependencies();
    const child = input.activeDocument;
    for (const name of ["A", "B"]) {
      child.instances.push({
        id: `P${name}`,
        symbolId: "port",
        placement: null,
      });
      child.nets.push({
        id: `net-${name}`,
        terminals: [{ instanceId: `P${name}`, pinName: "P" }],
      });
      child.netlist!.terminals.push({
        id: name,
        name,
        netId: `net-${name}`,
        direction: "passive",
        interfaceInstanceIds: [`P${name}`],
      });
    }
    const parent = createEmptyDocument("parent", "Parent");
    parent.instances.push({
      id: "X1",
      symbolId: "hierarchical-main",
      placement: null,
      netlist: {
        parameters: {},
        binding: { kind: "subcircuit", childDocumentId: child.id },
      },
    });
    parent.nets.push(
      { id: "a", terminals: [{ instanceId: "X1", pinName: "A" }] },
      { id: "b", terminals: [{ instanceId: "X1", pinName: "B" }] },
    );
    input.project.documents.push(parent);
    const requestConfirmation =
      vi.fn<(request: CellInterfaceConfirmation) => void>();
    const commands = createProjectStructureCommands({
      ...input,
      requestConfirmation,
    });
    commands.renameCellTerminal("A", "B");
    expect(input.commitStructure).not.toHaveBeenCalled();
    const merge = requestConfirmation.mock.calls[0]![0];
    expect(merge.title).toBe("Merge Cell Ports?");
    merge.apply();
    expect(JSON.stringify(input.commitStructure.mock.calls[0])).toContain(
      "merge_nets",
    );
    input.commitStructure.mockClear();
    commands.removeCellTerminalSelection(["A"], []);
    expect(input.commitStructure).not.toHaveBeenCalled();
    const deletion = requestConfirmation.mock.calls[1]![0];
    expect(deletion.message).toContain("Parent/X1");
    deletion.apply();
    expect(input.commitStructure).toHaveBeenCalledWith(
      "delete-cell-pin-selection",
      expect.any(Array),
    );
  });

  it("returns actionable external definition validation and commit results", () => {
    const input = dependencies();
    const commands = createProjectStructureCommands(input);
    const definition = {
      id: "external-amp",
      name: "amplifier",
      terminals: [{ id: "in", name: "IN", direction: "passive" as const }],
      formalParameters: [],
      interfaceStatus: "declared" as const,
    };
    expect(commands.setExternalSubcircuitDefinition(definition).ok).toBe(true);
    input.commitStructure.mockClear();
    const duplicate = commands.setExternalSubcircuitDefinition({
      ...definition,
      terminals: [
        ...definition.terminals,
        { id: "in2", name: "IN", direction: "passive" },
      ],
    });
    expect(duplicate.ok).toBe(false);
    expect(duplicate.message).toMatch(/duplicate/i);
    expect(input.commitStructure).not.toHaveBeenCalled();
    input.commitStructure.mockReturnValue(false);
    expect(commands.setExternalSubcircuitDefinition(definition)).toMatchObject({
      ok: false,
      message: expect.stringContaining("not changed"),
    });
  });

  it("does not silently replace a same-named external or shadow a local Cell", () => {
    const input = dependencies();
    const definition = {
      id: "external-amp",
      name: "amplifier",
      terminals: [],
      formalParameters: [],
      interfaceStatus: "declared" as const,
    };
    input.project.externalSubcircuitDefinitions.push(definition);
    const commands = createProjectStructureCommands(input);
    expect(
      commands.setExternalSubcircuitDefinition({ ...definition, id: "new-id" })
        .ok,
    ).toBe(false);
    expect(
      commands.setExternalSubcircuitDefinition({
        ...definition,
        name: input.activeDocument.netlist!.name,
      }).ok,
    ).toBe(false);
    expect(input.commitStructure).not.toHaveBeenCalled();
  });

  it("creates a trimmed Cell with inherited presentation and activates it", () => {
    const input = dependencies();
    input.activeDocument.presentation.grid = 25;
    const commands = createProjectStructureCommands(input);

    commands.createCell("  Child  ");

    const [transactionId, edits, activeDocumentId] =
      input.commitStructure.mock.calls[0]!;
    expect(transactionId).toBe("create-cell");
    expect(activeDocumentId).toBe("document-child");
    expect(edits).toMatchObject([
      {
        kind: "add_document",
        document: {
          id: "document-child",
          name: "Child",
          presentation: { grid: 25 },
          netlist: { name: "Child" },
        },
      },
    ]);
    expect(input.onCellCreated).toHaveBeenCalledOnce();
    expect(input.setStatus).toHaveBeenCalledWith("Created Cell Child");
  });

  it("deletes a Cell through the project structure boundary", () => {
    const input = dependencies();
    const child = createEmptyDocument("document-child", "Child");
    input.project.documents.push(child);
    const commands = createProjectStructureCommands(input);

    expect(commands.deleteCell(child.id)).toBe(true);

    expect(input.commitStructure).toHaveBeenCalledWith(
      "delete-cell",
      expect.arrayContaining([
        expect.objectContaining({
          kind: "remove_document",
          documentId: child.id,
        }),
      ]),
      input.project.topDocumentId,
    );
    expect(input.setStatus).toHaveBeenCalledWith("Deleted Cell Child");
  });

  it("normalizes a parameter default and rejects clearing it without committing", () => {
    const input = dependencies();
    const child = createEmptyDocument("document-child", "Child");
    input.project.documents.push(child);
    child.netlist!.formalParameters = [{ name: "gain", defaultValue: "1" }];
    const commands = createProjectStructureCommands(input);

    expect(
      commands.editCellParameter(
        "gain",
        { kind: "default", value: " 10 " },
        child.id,
      ).ok,
    ).toBe(true);

    expect(input.commitStructure).toHaveBeenCalledWith(
      "cell-parameter-default",
      expect.arrayContaining([
        {
          kind: "transact_document",
          documentId: child.id,
          expectedRevision: 0,
          edits: [
            {
              kind: "set_cell_formal_parameters",
              formalParameters: [{ name: "gain", defaultValue: "10" }],
            },
          ],
        },
      ]),
    );
    input.commitStructure.mockClear();
    expect(
      commands.editCellParameter(
        "gain",
        { kind: "default", value: "" },
        child.id,
      ).ok,
    ).toBe(false);
    expect(input.commitStructure).not.toHaveBeenCalled();
  });

  it("rejects off-grid Cell symbol dimensions before planning", () => {
    const input = dependencies();
    const commands = createProjectStructureCommands(input);

    commands.setCellSymbolBodySize(
      localBlockSymbolTarget(input.activeDocument),
      95,
      100,
    );

    expect(input.commitStructure).not.toHaveBeenCalled();
    expect(input.setStatus).toHaveBeenCalledWith(
      "Cell symbol size must use positive 10-unit grid values",
    );
  });

  it("owns Cell Pin annotation edits and structural deletion", () => {
    const input = dependencies();
    input.activeDocument.instances.push({
      id: "P1",
      symbolId: "port",
      placement: null,
    });
    input.activeDocument.nets.push({
      id: "net-in",
      terminals: [{ instanceId: "P1", pinName: "P" }],
    });
    input.activeDocument.netlist!.terminals.push({
      id: "terminal-in",
      name: "IN",
      netId: "net-in",
      direction: "input",
      interfaceInstanceIds: ["P1"],
    });
    const annotation = {
      id: "pin-label",
      kind: "instance-label" as const,
      binding: {
        kind: "cell-terminal-name" as const,
        terminalId: "terminal-in",
      },
      anchor: {
        kind: "object" as const,
        objectId: "P1",
        localOffset: { x: 0, y: 0 },
        fallbackPosition: { x: 0, y: 0 },
      },
      alignment: "middle" as const,
      rotation: 0 as const,
      locked: false,
    };
    input.activeDocument.annotations.push(annotation);
    const commands = createProjectStructureCommands(input);

    expect(commands.editCellTerminalAnnotation(annotation, "VIN")).toBe(true);
    expect(input.commitStructure).toHaveBeenCalledWith(
      "edit-cell-pin-label",
      expect.any(Array),
    );

    input.commitStructure.mockClear();
    expect(commands.deleteCellTerminal("terminal-in", "P1")).toBe(true);
    expect(input.commitStructure).toHaveBeenCalledWith(
      "delete-cell-pin",
      expect.arrayContaining([
        expect.objectContaining({ kind: "transact_document" }),
      ]),
    );
    expect(input.setStatus).toHaveBeenCalledWith("Deleted Cell Pin IN");
  });

  it("renames an annotation-owned Power Rail Cell Pin", () => {
    const input = dependencies();
    input.activeDocument.nets.push({ id: "net-vdd", terminals: [] });
    input.activeDocument.netlist!.terminals.push({
      id: "terminal-vdd",
      name: "VDD",
      netId: "net-vdd",
      direction: "inout",
      interfaceInstanceIds: [],
      interfaceAnnotationId: "label-vdd",
    });
    const annotation = {
      id: "label-vdd",
      kind: "power-label" as const,
      binding: {
        kind: "cell-terminal-name" as const,
        terminalId: "terminal-vdd",
      },
      netId: "net-vdd",
      anchor: {
        kind: "object" as const,
        objectId: "junction-vdd",
        localOffset: { x: 10, y: 10 },
        fallbackPosition: { x: 10, y: 10 },
      },
      alignment: "start" as const,
      rotation: 0 as const,
      locked: false,
    };
    input.activeDocument.annotations.push(annotation);
    const commands = createProjectStructureCommands(input);

    expect(commands.editCellTerminalAnnotation(annotation, "AVDD")).toBe(true);
    expect(input.commitStructure).toHaveBeenCalledWith(
      "edit-cell-pin-label",
      expect.arrayContaining([
        expect.objectContaining({ kind: "transact_document" }),
      ]),
    );
  });
});
