import { expect, it } from "vitest";
import { createEmptyProject } from "@icm/model";
import { createDesignNetlistExport } from "@icm/netlist";
import { executeProjectTransaction } from "./project-transaction.js";
import { createExternalSubcircuitInstance } from "./hierarchy-planner.js";
import {
  prepareComponentVariant,
  planComponentDefinitionApply,
} from "./component-authoring-target.js";

it("isolates a variant while definition edits address every caller by identity", () => {
  const empty = createEmptyProject("test", "test");
  const applied = executeProjectTransaction(empty, {
    projectId: empty.id,
    expectedStructureRevision: 0,
    transactionId: "create",
    actor: { kind: "agent", id: "test" },
    edits: [
      {
        kind: "apply_model_source",
        source: {
          id: "source",
          revision: 0,
          language: "spice",
          entry: "model.spice",
          dependencies: [],
          files: [
            {
              path: "model.spice",
              text: ".subckt stage A B params: R=1k\nR1 A B {R}\n.ends stage\n",
            },
          ],
        },
        definitions: [{ definitionId: "owner", entry: "stage" }],
      },
    ],
  });
  if (!applied.ok) throw Error(applied.error.message);
  const project = applied.project;
  const owner = project.externalSubcircuitDefinitions[0]!;
  project.documents[0]!.instances = ["X1", "X2"].map((id, index) =>
    createExternalSubcircuitInstance(id, owner, {
      position: { x: index * 100, y: 0 },
      rotation: 0,
      mirror: "none",
    }),
  );
  project.documents[0]!.nets = [
    {
      id: "signal",
      terminals: [
        { instanceId: "X1", pinName: "A" },
        { instanceId: "X2", pinName: "A" },
      ],
    },
  ];
  project.documents[0]!.noConnects = ["X1", "X2"].map((id) => ({
    id: id + "-nc",
    endpoint: { kind: "terminal" as const, instanceId: id, pinName: "B" },
  }));
  const before = structuredClone(project);
  const variant = prepareComponentVariant(
    project,
    project.documents[0]!.id,
    "X1",
    "v2",
  );
  expect(project).toEqual(before);
  expect(variant.project.documents[0]!.instances[1]).toEqual(
    before.documents[0]!.instances[1],
  );
  expect(variant.project.documents[0]!.nets).toEqual(
    project.documents[0]!.nets,
  );
  expect(variant.project.documents[0]!.noConnects).toEqual(
    project.documents[0]!.noConnects,
  );
  expect(variant.project.modelSources).toHaveLength(2);
  expect(variant.project.modelSources![1]!.files[0]!.text).toContain(
    ".subckt stage_v2",
  );
  expect(variant.project.documents[0]!.instances[0]!.netlist!.binding).toEqual({
    kind: "external-subcircuit",
    definitionId: variant.definitionId,
  });
  const source = structuredClone(project.modelSources![0]!);
  const planned = planComponentDefinitionApply(project, {
    kind: "apply_model_source",
    source,
    definitions: [
      {
        definitionId: owner.id,
        entry: owner.name,
        authoring: { symbolMode: "automatic" },
      },
    ],
  });
  expect(planned.definitions[0]!.callers?.map((c) => c.instanceId)).toEqual([
    "X1",
    "X2",
  ]);
  expect(
    createDesignNetlistExport(variant.project, {
      format: "spice",
    }).diagnostics.some((d) => d.code === "MODEL_SOURCE_NAME_CONFLICT"),
  ).toBe(false);
});
