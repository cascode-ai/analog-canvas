import { createEmptyDocument, createEmptyProject } from "@icm/model";
import { describe, expect, it } from "vitest";
import {
  cellParameterUsage,
  planBindCellParameter,
  planRenameCellParameter,
  planSetCellParameterDefault,
  planRemoveCellParameter,
} from "./cell-parameter-planner.js";
import {
  executeProjectTransaction,
  type ProjectStructureEdit,
} from "./project-transaction.js";

function fixture() {
  const project = createEmptyProject("project", "Project");
  const child = createEmptyDocument("child", "Resistors");
  child.netlist = { name: "Resistors", terminals: [], formalParameters: [] };
  child.instances.push(
    ...["R1", "R2"].map((id) => ({
      id,
      symbolId: "resistor",
      reference: id,
      placement: null,
      netlist: { parameters: { value: "1k" } },
    })),
  );
  project.documents.push(child);
  project.documents[0]!.instances.push(
    ...["X1", "X2"].map((id) => ({
      id,
      symbolId: "cell:Resistors",
      reference: id,
      placement: null,
      netlist: {
        binding: { kind: "subcircuit" as const, childDocumentId: child.id },
        parameters: {},
      },
    })),
  );
  return project;
}

function apply(
  project: ReturnType<typeof fixture>,
  edits: ProjectStructureEdit[],
) {
  const result = executeProjectTransaction(project, {
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    transactionId: "parameters",
    actor: { kind: "human", id: "test" },
    edits,
  });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error("Transaction rejected");
  return result.project;
}

describe("Cell parameter authoring", () => {
  it("changes defaults without touching overrides and removes only unused declarations", () => {
    const project = fixture();
    project.documents[1]!.netlist!.formalParameters = [
      { name: "Rbase", defaultValue: "1k" },
      { name: "Unused", defaultValue: "2k" },
    ];
    project.documents[0]!.instances[0]!.netlist!.parameters = { Rbase: "5k" };
    const changed = apply(
      project,
      planSetCellParameterDefault(project, "child", "Rbase", "3k"),
    );
    expect(
      changed.documents[1]!.netlist!.formalParameters[0]!.defaultValue,
    ).toBe("3k");
    expect(changed.documents[0]!.instances[0]!.netlist!.parameters).toEqual({
      Rbase: "5k",
    });
    expect(() => planRemoveCellParameter(changed, "child", "Rbase")).toThrow(
      "overridden",
    );
    const removed = apply(
      changed,
      planRemoveCellParameter(changed, "child", "Unused"),
    );
    expect(
      removed.documents[1]!.netlist!.formalParameters.map((item) => item.name),
    ).toEqual(["Rbase"]);
    expect(() =>
      planSetCellParameterDefault(changed, "child", "Rbase", ""),
    ).toThrow("Default");
    expect(() =>
      planSetCellParameterDefault(changed, "child", "Rbase", "{Unused}"),
    ).not.toThrow();
    changed.documents[1]!.netlist!.formalParameters[1]!.defaultValue =
      "{Rbase}";
    expect(() =>
      planSetCellParameterDefault(changed, "child", "Rbase", "{Unused}"),
    ).toThrow("Cyclic");
  });

  it("keeps incomplete references visible to deletion safety and rejects unsafe rewrites", () => {
    const project = fixture();
    project.documents[1]!.netlist!.formalParameters = [
      { name: "Rbase", defaultValue: "1k" },
    ];
    project.documents[1]!.instances[0]!.netlist!.parameters.value = "{Rbase +}";
    expect(() => planRemoveCellParameter(project, "child", "Rbase")).toThrow(
      "referenced",
    );
    expect(() =>
      planRenameCellParameter(project, "child", "Rbase", "Resistance"),
    ).toThrow("unsupported");
  });
  it("creates and reuses a declaration atomically without populating caller overrides", () => {
    const before = fixture();
    const project = apply(
      before,
      planBindCellParameter(before, "child", "R1", "value", "Rbase", "1k"),
    );
    expect(before.documents[1]!.netlist!.formalParameters).toEqual([]);
    expect(project.documents[1]!.netlist!.formalParameters).toEqual([
      { name: "Rbase", defaultValue: "1k" },
    ]);
    const reused = apply(
      project,
      planBindCellParameter(project, "child", "R2", "value", "rbase"),
    );
    expect(
      reused.documents[1]!.instances.map(
        (instance) => instance.netlist!.parameters.value,
      ),
    ).toEqual(["{Rbase}", "{Rbase}"]);
    expect(
      reused.documents[0]!.instances.map(
        (instance) => instance.netlist!.parameters,
      ),
    ).toEqual([{}, {}]);
    expect(
      cellParameterUsage(reused.documents[1]!, "Rbase").fields,
    ).toHaveLength(2);
  });

  it("renames references, dependent defaults and caller keys, preserving parent scope", () => {
    const before = fixture();
    const child = before.documents[1]!;
    child.netlist!.formalParameters = [
      { name: "Rbase", defaultValue: "1k" },
      { name: "Rother", defaultValue: "{2*Rbase}" },
    ];
    child.instances[0]!.netlist!.parameters.value = "{Rbase}";
    child.instances[1]!.netlist!.parameters.value = "'2*rbase'";
    before.documents[0]!.instances[0]!.netlist!.parameters = {
      Rbase: "{Rbase * 3}",
    };
    before.documents[0]!.annotations.push({
      id: "parameter-label",
      kind: "instance-value",
      binding: { kind: "instance-value", instanceId: "X1", parameter: "Rbase" },
      anchor: { kind: "free", position: { x: 0, y: 0 } },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    const project = apply(
      before,
      planRenameCellParameter(before, "child", "Rbase", "Resistance"),
    );
    expect(
      project.documents[1]!.instances.map(
        (instance) => instance.netlist!.parameters.value,
      ),
    ).toEqual(["{Resistance}", "'2*Resistance'"]);
    expect(project.documents[1]!.netlist!.formalParameters).toEqual([
      { name: "Resistance", defaultValue: "1k" },
      { name: "Rother", defaultValue: "{2*Resistance}" },
    ]);
    expect(project.documents[0]!.instances[0]!.netlist!.parameters).toEqual({
      Resistance: "{Rbase * 3}",
    });
    expect(project.documents[0]!.instances[1]!.netlist!.parameters).toEqual({});
    expect(
      project.documents[0]!.annotations.find(
        (annotation) => annotation.id === "parameter-label",
      )?.binding,
    ).toEqual({
      kind: "instance-value",
      instanceId: "X1",
      parameter: "Resistance",
    });
    expect(before.documents[0]!.instances[0]!.netlist!.parameters).toEqual({
      Rbase: "{Rbase * 3}",
    });
  });

  it("rejects missing defaults, name collisions and reference capture before editing", () => {
    const project = fixture();
    expect(() =>
      planBindCellParameter(project, "child", "R1", "value", "Rbase"),
    ).toThrow("default");
    expect(() =>
      planBindCellParameter(
        project,
        "child",
        "R1",
        "value",
        "Rbase",
        "{Rbase}",
      ),
    ).toThrow("itself");
    project.documents[1]!.netlist!.formalParameters = [
      { name: "Rbase", defaultValue: "1k" },
      { name: "Other", defaultValue: "2k" },
    ];
    expect(() =>
      planRenameCellParameter(project, "child", "Rbase", "other"),
    ).toThrow("already exists");
    project.documents[1]!.instances[1]!.netlist!.parameters.value =
      "{GlobalValue}";
    expect(() =>
      planRenameCellParameter(project, "child", "Rbase", "GlobalValue"),
    ).toThrow("capture");
    project.documents[0]!.instances[0]!.netlist!.parameters = {
      Rbase: "1k",
      New: "2k",
    };
    expect(() =>
      planRenameCellParameter(project, "child", "Rbase", "New"),
    ).toThrow("conflicting");
  });
});
