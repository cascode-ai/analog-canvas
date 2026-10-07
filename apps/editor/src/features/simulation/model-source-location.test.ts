import { expect, it } from "vitest";
import { createEmptyProject, createSimulationFolder } from "@icm/model";
import {
  createExternalSubcircuitInstance,
  executeProjectTransaction,
} from "@icm/edit-engine";
import { compileNgspiceSourceSimulation } from "@icm/netlist";
import { modelSourceDiagnosticLocation } from "./model-source-location";

it("locates a runtime model error in the exact original snapshot rather than a folder copy", async () => {
  const project = createEmptyProject("error", "Error");
  const applied = executeProjectTransaction(project, {
    projectId: project.id,
    expectedStructureRevision: 0,
    transactionId: "define",
    actor: { kind: "human", id: "test" },
    edits: [
      {
        kind: "apply_model_source",
        source: {
          id: "source",
          revision: 0,
          language: "spice",
          entry: "body.spice",
          files: [
            {
              path: "body.spice",
              text: "* native body\n.subckt error_model A B\nB1 B 0 V={unknown_function(v(A))}\n.ends error_model\n",
            },
          ],
          dependencies: [],
        },
        definitions: [{ definitionId: "model", entry: "error_model" }],
      },
    ],
  });
  if (!applied.ok) throw Error(JSON.stringify(applied));
  const owned = applied.project;
  owned.documents[0]!.instances.push(
    createExternalSubcircuitInstance(
      "X1",
      owned.externalSubcircuitDefinitions[0]!,
      { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    ),
  );
  owned.documents[0]!.noConnects.push(
    ...["A", "B"].map((pinName) => ({
      id: `nc-${pinName}`,
      endpoint: { kind: "terminal" as const, instanceId: "X1", pinName },
    })),
  );
  const compiled = compileNgspiceSourceSimulation(
    owned,
    createSimulationFolder({
      id: "sim",
      name: "Sim",
      engine: "ngspice",
      profileId: "ngspice",
      documentId: owned.documents[0]!.id,
    }),
  );
  if (!compiled.ok) throw Error(JSON.stringify(compiled));
  const file = compiled.generated[0]!;
  const offset = file.text.indexOf("B1 B 0");
  const diagnostic = {
    file: "/executor/run/" + file.path,
    line: file.text.slice(0, offset).split("\n").length,
  };
  const archived = JSON.parse(JSON.stringify(compiled.sourceMaps));
  const location = await modelSourceDiagnosticLocation(
    diagnostic,
    file.text,
    archived,
    compiled.modelSources,
  );
  expect(location).toMatchObject({
    scope: "model-source",
    sourceId: "source",
    revision: 1,
    path: "body.spice",
    line: 3,
    column: 1,
    startOffset: compiled.modelSources![0]!.files[0]!.text.indexOf("B1 B 0"),
  });
  expect(
    await modelSourceDiagnosticLocation(
      diagnostic,
      file.text,
      [...archived, ...archived],
      compiled.modelSources,
    ),
  ).toBeUndefined();
  expect(
    await modelSourceDiagnosticLocation(
      diagnostic,
      file.text,
      [{ path: file.path, segments: [null] }],
      compiled.modelSources,
    ),
  ).toBeUndefined();
});
