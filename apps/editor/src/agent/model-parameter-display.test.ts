import { describe, expect, it } from "vitest";
import { createEmptyDocument, flattenRichText } from "@icm/model";
import { instanceDisplayParameters, resolveAnnotationText } from "@icm/derived";
import { hierarchicalSymbolId } from "@icm/symbols";
import { renderDocumentSvg } from "@icm/render-svg";
import {
  emptyAgentProject,
  liveAgentEditor,
  personEdits,
} from "./live-agent-editor.test-support";
import { componentPropertyCodeValue } from "../features/properties/component-property-code";
import { EditorDocumentController } from "../document/document-controller";

function geometryProject() {
  const project = emptyAgentProject("Bound parameter display");
  project.externalSubcircuitDefinitions.push({
    id: "poly",
    name: "sky130_fd_pr__res_high_po",
    interfaceStatus: "declared",
    terminals: ["R0", "R1", "B"].map((name) => ({
      id: name,
      name,
      direction: "passive" as const,
    })),
    formalParameters: [],
  });
  project.documents[0]!.instances.push({
    id: "r",
    reference: "R1",
    symbolId: "resistor",
    placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
    netlist: {
      binding: { kind: "external-subcircuit", definitionId: "poly" },
      parameters: { w: "1u", l: "43u", mult: "2" },
    },
  });
  return project;
}

describe("bound parameters through the editor", () => {
  it("uses a Cell's declared parameters and preserves a manually styled label when toggled", async () => {
    const project = emptyAgentProject("Cell parameter display");
    const child = createEmptyDocument("child", "Child");
    child.netlist = {
      name: "Child",
      terminals: [],
      formalParameters: [{ name: "SIZE", defaultValue: "7" }],
    };
    project.documents.push(child);
    project.documents[0]!.instances.push({
      id: "x",
      reference: "X1",
      symbolId: hierarchicalSymbolId("Child"),
      placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
      netlist: {
        binding: { kind: "subcircuit", childDocumentId: "child" },
        parameters: { SIZE: "12" },
      },
    });
    const { controller, client } = liveAgentEditor({ project });
    await client.connect("session-1.code");
    const toggle = (visible: boolean) =>
      client.applyActions([
        {
          kind: "set-instance-display",
          instanceIds: ["x"],
          showParameters: { SIZE: visible },
        },
      ]);
    expect(await toggle(true)).toMatchObject({ ok: true });
    const label = structuredClone(controller.document.annotations[0]!);
    label.anchor = {
      kind: "object",
      objectId: "x",
      localOffset: { x: 80, y: 50 },
      fallbackPosition: { x: 180, y: 150 },
    };
    label.sizeScale = 2;
    label.alignment = "end";
    personEdits(controller, [
      { kind: "upsert_schematic_annotation", annotation: label },
    ]);
    await client.snapshot("main", { refresh: true });
    expect(await toggle(false)).toMatchObject({ ok: true });
    expect(await toggle(true)).toMatchObject({ ok: true });
    expect(controller.document.annotations[0]).toEqual(label);
    expect(
      renderDocumentSvg(controller.document, controller.resolver),
    ).toContain("SIZE = 12");
    expect(
      controller.dispatchTransaction({
        transactionId: "change-cell-parameters",
        documentId: "child",
        expectedRevision: controller.project.documents[1]!.revision,
        actor: { kind: "human", id: "test" },
        edits: [
          {
            kind: "set_cell_formal_parameters",
            formalParameters: [{ name: "GAIN", defaultValue: "3" }],
          },
        ],
      }).ok,
    ).toBe(true);
    const caller = () => controller.project.documents[0]!.instances[0]!;
    expect(
      instanceDisplayParameters(caller(), controller.resolver).map(
        (p) => p.name,
      ),
    ).toEqual(["GAIN"]);
    personEdits(controller, [{ kind: "undo" }]);
    expect(
      instanceDisplayParameters(caller(), controller.resolver).map(
        (p) => p.name,
      ),
    ).toEqual(["SIZE"]);
    personEdits(controller, [{ kind: "redo" }]);
    expect(
      instanceDisplayParameters(caller(), controller.resolver).map(
        (p) => p.name,
      ),
    ).toEqual(["GAIN"]);
  });

  it("keeps geometry labels upright through rotation and restores binding changes through history", async () => {
    const { controller, client } = liveAgentEditor({
      project: geometryProject(),
    });
    await client.connect("session-1.code");
    expect(
      await client.applyActions([
        {
          kind: "set-instance-display",
          instanceIds: ["r"],
          showParameters: { l: true },
        },
      ]),
    ).toMatchObject({ ok: true });
    const original = structuredClone(controller.document.annotations[0]!);
    personEdits(controller, [
      { kind: "rotate_instance", instanceId: "r", rotation: 90 },
    ]);
    const rotated = structuredClone(controller.document.annotations[0]!);
    expect(rotated.rotation).toBe(0);
    expect(rotated.anchor).not.toEqual(original.anchor);
    personEdits(controller, [{ kind: "undo" }]);
    expect(controller.document.annotations[0]).toEqual(original);
    personEdits(controller, [{ kind: "redo" }]);
    expect(controller.document.annotations[0]).toEqual(rotated);
    personEdits(controller, [
      {
        kind: "set_instance_binding",
        instanceId: "r",
        binding: { kind: "primitive", deviceClass: "resistor" },
      },
    ]);
    expect(controller.document.annotations[0]!.visible).toBe(false);
    personEdits(controller, [{ kind: "undo" }]);
    expect(controller.document.annotations[0]).toEqual(rotated);
    expect(
      renderDocumentSvg(controller.document, controller.resolver),
    ).toContain("43u");
  });

  it("shows only declared custom parameters without inventing a summary or default values", async () => {
    const project = geometryProject();
    const definition = project.externalSubcircuitDefinitions[0]!;
    definition.name = "custom_R";
    definition.formalParameters = [{ name: "SIZE", defaultValue: "7" }];
    project.documents[0]!.instances[0]!.netlist!.parameters = {
      SIZE: "{size}",
    };
    const { controller, client } = liveAgentEditor({ project });
    await client.connect("session-1.code");
    expect(
      await client.applyActions([
        {
          kind: "set-instance-display",
          instanceIds: ["r"],
          showParameters: { SIZE: true },
        },
      ]),
    ).toMatchObject({ ok: true });
    expect(
      renderDocumentSvg(controller.document, controller.resolver),
    ).toContain("{size}");
    personEdits(controller, [
      {
        kind: "patch_instance_netlist_parameters",
        instanceId: "r",
        unset: ["SIZE"],
      },
    ]);
    expect(controller.document.annotations[0]!.visible).toBe(false);
    expect(
      renderDocumentSvg(controller.document, controller.resolver),
    ).not.toContain("SIZE = 7");
  });

  it("shares Properties, Agent, edited labels and exported text without changing electrical values", async () => {
    const { controller, client } = liveAgentEditor({
      project: geometryProject(),
    });
    await client.connect("session-1.code");
    const electrical = structuredClone(
      controller.document.instances[0]!.netlist,
    );
    expect(
      componentPropertyCodeValue({
        instance: controller.document.instances[0]!,
        resolver: controller.resolver,
        referenceVisible: false,
        valueVisible: false,
      }).display?.parameters,
    ).toEqual({ w: false, l: false, mult: false });
    expect(
      await client.applyActions([
        {
          kind: "set-instance-display",
          instanceIds: ["r"],
          showValue: true,
          showParameters: { l: true, mult: true },
        },
      ]),
    ).toMatchObject({ ok: true });
    const texts = () =>
      controller.document.annotations
        .filter((a) => a.visible !== false)
        .map((a) =>
          flattenRichText(
            resolveAnnotationText(
              controller.document,
              a,
              undefined,
              controller.resolver,
            ),
          ),
        );
    expect(texts()).toContain("W=1u L=43u ×2");
    expect(texts()).toContain("L = 43u");
    const pins = await client.pinsSnapshot(["r"], "main", {
      instanceLabels: true,
    });
    expect(
      pins.instances[0]!.annotations?.find((a) => a.parameter === "mult")
        ?.visible,
    ).toBe(false);
    expect(controller.document.instances[0]!.netlist).toEqual(electrical);
    const length = controller.document.annotations.find(
      (a) =>
        a.binding?.kind === "instance-value" && a.binding.parameter === "l",
    )!;
    expect(
      await client.applyActions([
        {
          kind: "set-text",
          target: { kind: "annotation", id: length.id },
          text: "L = 50u",
        },
      ]),
    ).toMatchObject({ ok: true });
    expect(texts()).toContain("W=1u L=50u ×2");
    expect(controller.document.instances[0]!.netlist?.parameters.l).toBe("50u");
    const reopened = new EditorDocumentController(
      JSON.parse(JSON.stringify(controller.project)),
    );
    expect(renderDocumentSvg(reopened.document, reopened.resolver)).toContain(
      "W=1u L=50u ×2",
    );
    const before = structuredClone(controller.project);
    expect(
      await client.applyActions([
        {
          kind: "set-instance-display",
          instanceIds: ["r"],
          showReference: false,
          showParameters: { imaginary: true },
        },
      ]),
    ).toMatchObject({ ok: false });
    expect(controller.project).toEqual(before);
    personEdits(controller, [
      {
        kind: "set_instance_netlist",
        instanceId: "r",
        netlist: {
          binding: { kind: "primitive", deviceClass: "resistor" },
          parameters: { value: "10k" },
        },
      },
    ]);
    expect(texts()).toContain("10k");
    expect(texts()).not.toContain("L = 50u");
  });
});
