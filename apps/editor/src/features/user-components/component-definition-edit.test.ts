import { describe, expect, it } from "vitest";
import { createEmptyProject, type Instance } from "@icm/model";
import { withProjectComponentDefinitions } from "@icm/symbols";
import { EditorDocumentController } from "../../document/document-controller";
import { createDesignNetlistExport } from "@icm/netlist";
import { deriveSelectionInspectionModel } from "../selection/selection-inspection-model";
import {
  captureProjectCopy,
  planProjectCopyPlacement,
} from "../clipboard/project-copy";
import {
  planComponentDefinitionEdit,
  newComponentDefinition,
  sharedComponentNetlist,
} from "./component-definition-edit";
import {
  parseSharedDefinition,
  publishedDefinition,
} from "./component-library-contract";

function fixture() {
  const project = createEmptyProject("test", "Test");
  project.documents[0]!.instances = ["R1", "R2"].map((id, index): Instance => ({
    id,
    reference: id,
    symbolId: "resistor",
    placement: {
      position: { x: index * 100, y: 0 },
      rotation: 0,
      mirror: "none",
    },
    netlist: {
      binding: { kind: "primitive", deviceClass: "resistor" },
      parameters: { value: "2k" },
    },
  }));
  return withProjectComponentDefinitions(project);
}

describe("component definition authoring", () => {
  it("starts with a self-contained black-box interface and explicit supply ports", () => {
    const definition = parseSharedDefinition(newComponentDefinition());
    expect(definition.subcircuit?.ports.map((port) => port.name)).toEqual([
      "VDD",
      "VSS",
      "IN",
      "OUT",
    ]);
    expect(sharedComponentNetlist(definition)?.binding).toEqual({
      kind: "unresolved-subcircuit",
      name: "custom_block",
    });
  });
  it("forks only the selected instance and undo restores its exact definition", () => {
    const controller = new EditorDocumentController(fixture());
    const original = controller.project;
    const [selected, peer] = controller.document.instances;
    const definition = publishedDefinition(
      original.componentDefinitions![0]!,
      "test-component",
      1,
    );
    definition.symbol.primitives.push({
      kind: "circle",
      center: { x: 8, y: 0 },
      radius: 3,
    });
    const plan = planComponentDefinitionEdit(
      original,
      controller.document.id,
      selected!.id,
      selected!,
      definition,
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    controller.commitProjectStructure(plan.project);
    expect(controller.document.instances[0]).toEqual({
      ...selected,
      symbolId: definition.symbol.id,
    });
    expect(controller.document.instances[1]).toEqual(peer);
    expect(controller.project.componentDefinitions).toHaveLength(2);
    const clipboard = captureProjectCopy(
      controller.project,
      controller.document,
      {
        instanceIds: [selected!.id],
        draftingIds: [],
        routeIds: [],
        junctionIds: [],
        annotationIds: [],
      },
    )!;
    const copied = planProjectCopyPlacement(
      controller.project,
      controller.document,
      clipboard,
      { x: 200, y: 100 },
      1,
    );
    const copy = copied.edits
      .flatMap((edit) => (edit.kind === "transact_document" ? edit.edits : []))
      .find((edit) => edit.kind === "add_instance");
    expect(copy?.kind === "add_instance" && copy.instance.reference).toBe("R3");
    expect(controller.transact([{ kind: "undo" }]).ok).toBe(true);
    expect(controller.project.componentDefinitions).toEqual(
      original.componentDefinitions,
    );
    expect(controller.document.instances).toEqual(
      original.documents[0]!.instances,
    );
    expect(controller.document.nets).toEqual(original.documents[0]!.nets);
    expect(controller.transact([{ kind: "redo" }]).ok).toBe(true);
    expect(controller.document.instances[0]!.symbolId).toBe(
      definition.symbol.id,
    );
  });
  it("does not replace a changed instance or drop a connected pin", () => {
    const project = fixture();
    const document = project.documents[0]!;
    const selected = structuredClone(document.instances[0]!);
    const definition = publishedDefinition(
      project.componentDefinitions![0]!,
      "test-component",
      1,
    );
    document.instances[0]!.reference = "R3";
    expect(
      planComponentDefinitionEdit(
        project,
        document.id,
        selected.id,
        selected,
        definition,
      ).ok,
    ).toBe(false);
    document.instances[0] = selected;
    document.nets.push({
      id: "net",
      terminals: [{ instanceId: selected.id, pinName: "2" }],
    });
    definition.symbol.pins.pop();
    definition.electrical!.pinOrder.pop();
    expect(
      planComponentDefinitionEdit(
        project,
        document.id,
        selected.id,
        selected,
        definition,
      ),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("Disconnect"),
    });
  });

  it("keeps embedded electrical parameters editable and exports the custom device contract", () => {
    const controller = new EditorDocumentController(fixture());
    const document = controller.document;
    const selected = document.instances[0]!;
    const definition = publishedDefinition(
      controller.project.componentDefinitions![0]!,
      "test-component",
      1,
    );
    const plan = planComponentDefinitionEdit(
      controller.project,
      document.id,
      selected.id,
      selected,
      definition,
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    controller.commitProjectStructure(plan.project);
    const inspection = deriveSelectionInspectionModel({
      project: controller.project,
      document: controller.document,
      resolver: controller.resolver,
      selection: {
        instanceIds: [selected.id],
        routeIds: [],
        junctionIds: [],
        annotationIds: [],
        draftingIds: [],
      },
      selectedEndpoint: null,
    });
    expect(
      inspection.selectedPropertyDevice?.parameters.map(
        (parameter) => parameter.name,
      ),
    ).toContain("value");
    const project = structuredClone(controller.project);
    project.documents[0]!.nets = ["1", "2"].map((pinName, index) => ({
      id: `net${index}`,
      terminals: project.documents[0]!.instances.map((instance) => ({
        instanceId: instance.id,
        pinName,
      })),
    }));
    const exported = createDesignNetlistExport(project);
    expect(exported.status, JSON.stringify(exported.diagnostics)).toBe("ready");
    if (exported.status === "ready")
      expect(exported.file.text).toContain("R1 net0 net1 2k");
  });
  it("stages shared definitions without saving unused classes and inserts through normal history", () => {
    const controller = new EditorDocumentController(
      createEmptyProject("empty", "Empty"),
    );
    const before = controller.project;
    const definition = publishedDefinition(
      newComponentDefinition(),
      "test-component",
      1,
    );
    controller.offerComponentDefinition(definition);
    expect(controller.project).toBe(before);
    expect(
      controller.resolver.resolve(definition.symbol.id)?.definition,
    ).toEqual(definition.symbol);
    const instance: Instance = {
      id: "X1",
      reference: "X1",
      symbolId: definition.symbol.id,
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      netlist: sharedComponentNetlist(definition),
    };
    expect(controller.transact([{ kind: "add_instance", instance }]).ok).toBe(
      true,
    );
    expect(controller.project.componentDefinitions).toEqual([definition]);
    expect(controller.transact([{ kind: "undo" }]).ok).toBe(true);
    expect(controller.project.componentDefinitions ?? []).toEqual([]);
    expect(controller.transact([{ kind: "redo" }]).ok).toBe(true);
    expect(controller.project.componentDefinitions).toEqual([definition]);
    const overwrite = structuredClone(definition);
    overwrite.symbol.name = "Replaced";
    expect(() => controller.offerComponentDefinition(overwrite)).toThrow(
      "cannot be overwritten",
    );
  });
});
