import { createEmptyProject, type CircuitProject } from "@icm/model";
import { executeProjectTransaction } from "@icm/edit-engine";
import { externalSubcircuitSymbolId } from "@icm/symbols";
export function finiteGainProject(id: string): CircuitProject {
  const project = createEmptyProject(id, id);
  project.externalSubcircuitDefinitions.push({
    id: "finite",
    name: "finite_gain",
    interfaceStatus: "declared",
    terminals: ["IN", "OUT", "VSS"].map((name) => ({
      id: `pin-${name}`,
      name,
      direction: "passive",
    })),
    formalParameters: [],
  });
  const applied = executeProjectTransaction(project, {
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    transactionId: "apply-finite",
    actor: { kind: "human", id: "test" },
    edits: [
      {
        kind: "apply_model_source",
        source: {
          id: "finite-source",
          language: "spectre",
          entry: "main.scs",
          revision: 0,
          dependencies: [],
          files: [
            {
              path: "main.scs",
              text: 'simulator lang=spectre\ninclude "helper.scs"\nsubckt finite_gain (IN OUT VSS)\nparameters GAIN=10\nXCORE (IN OUT VSS) core GAIN=GAIN\nends finite_gain\n',
            },
            {
              path: "helper.scs",
              text: "subckt core (IN OUT VSS)\nparameters GAIN=10\nE1 (OUT VSS IN VSS) vcvs gain=GAIN\nends core\n",
            },
          ],
        },
        definitions: [{ definitionId: "finite", entry: "finite_gain" }],
      },
    ],
  });
  if (!applied.ok) throw new Error(applied.error.message);
  const source = applied.project;
  const document = source.documents[0]!;
  document.instances.push({
    id: "X1",
    reference: "X1",
    symbolId: externalSubcircuitSymbolId("finite"),
    placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    netlist: {
      binding: { kind: "external-subcircuit", definitionId: "finite" },
      parameters: { GAIN: "10" },
    },
  });
  for (const [pinName, name] of [
    ["IN", "IN"],
    ["OUT", "OUT"],
    ["VSS", "0"],
  ]) {
    const netId = `net-${pinName}`;
    const annotationId = `label-${pinName}`;
    document.nets.push({
      id: netId,
      terminals: [{ instanceId: "X1", pinName: pinName! }],
    });
    document.annotations.push({
      id: annotationId,
      kind: "net-label",
      netId,
      binding: { kind: "net-name", netId },
      anchor: {
        kind: "free",
        position: { x: -500, y: document.nets.length * 100 },
      },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    document.connectivityEvidence.push({
      id: `claim-${pinName}`,
      kind: "name-claim",
      netId,
      name: name!,
      scope: name === "0" ? "global" : "local",
      owner: { kind: "net-label", annotationId },
      ...(name === "0" ? { powerDomain: "ground" as const } : {}),
    });
  }
  return source;
}
