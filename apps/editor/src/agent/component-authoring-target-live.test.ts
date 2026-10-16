import { expect, it } from "vitest";
import { liveAgentEditor } from "./live-agent-editor.test-support";
import { nativePackage } from "../../../../worker/component-library.test-support";
import {
  createCircuitComponentPackageProject,
  createExternalSubcircuitInstance,
} from "@icm/edit-engine";

it("Agent variants isolate sources and definition Apply targets the shared owner", async () => {
  const packaged = nativePackage();
  const project = createCircuitComponentPackageProject(packaged, "target-test");
  const owner = project.externalSubcircuitDefinitions[0]!;
  project.documents[0]!.instances = ["X1", "X2"].map((id, index) =>
    createExternalSubcircuitInstance(id, owner, {
      position: { x: index * 100, y: 0 },
      rotation: 0,
      mirror: "none",
    }),
  );
  const { client, controller } = liveAgentEditor({ project });
  await client.connect("session-1.code");
  await client.snapshot();
  const created = await client.applyActions([
    {
      kind: "create-component-variant",
      instanceId: "X1",
      identity: "agent_variant",
    },
  ]);
  expect(created.ok, created.message).toBe(true);
  expect(controller.project.documents[0]!.instances[1]).toEqual(
    project.documents[0]!.instances[1],
  );
  expect(controller.project.modelSources).toHaveLength(2);
  const binding =
    controller.project.documents[0]!.instances[0]!.netlist!.binding;
  if (binding?.kind !== "external-subcircuit")
    throw Error("Variant binding missing");
  const variant = controller.project.externalSubcircuitDefinitions.find(
    (d) => d.id === binding.definitionId,
  )!;
  const source = controller.project.modelSources!.find(
    (s) => s.id === variant.implementation!.sourceId,
  )!;
  const changed = await client.applyActions([
    {
      kind: "apply-component-definition",
      edit: {
        kind: "apply_model_source",
        source: {
          ...source,
          files: source.files.map((f) => ({
            ...f,
            text: f.text.replace("value=1k", "value=2k"),
          })),
        },
        definitions: [
          {
            definitionId: variant.id,
            entry: variant.name,
            authoring: { symbolMode: "automatic" },
          },
        ],
      },
    },
  ]);
  expect(changed.ok, changed.message).toBe(true);
  expect(controller.project.modelSources![0]).toEqual(project.modelSources![0]);
  expect(
    controller.project.externalSubcircuitDefinitions.find(
      (d) => d.id === variant.id,
    )!.formalParameters[0]!.defaultValue,
  ).toBe("2k");
});
