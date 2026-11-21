import type { CircuitProject } from "@icm/model";
import { importSpiceSources } from "../../packages/spice/src/index.js";
import {
  executeProjectTransaction,
  planSetDeviceModelTarget,
  type ProjectStructureEdit,
  type SchematicEdit,
} from "../../packages/edit-engine/src/index.js";

function edit(project: CircuitProject, edits: ProjectStructureEdit[]) {
  const result = executeProjectTransaction(project, {
    transactionId: "pin-order-op",
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    actor: { kind: "agent", id: "test" },
    edits,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.project;
}

function editTop(project: CircuitProject, edits: SchematicEdit[]) {
  const document = project.documents.find(
    ({ id }) => id === project.topDocumentId,
  )!;
  return edit(project, [
    {
      kind: "transact_document",
      documentId: document.id,
      expectedRevision: document.revision,
      edits,
    },
  ]);
}

const dividerDeck = [
  "Hierarchical divider and differential gain",
  ".subckt divider VIN MID VSS",
  "RH VIN MID 2k",
  "RL MID VSS 1k",
  ".ends divider",
  "V1 in 0 3",
  "V2 ref 0 0.5",
  "RL out 0 10k",
  "XDIV in mid 0 divider",
  ".end",
  "",
].join("\n");
const gainModel =
  ".subckt gain_two INN OUT INP\nE1 OUT 0 INP INN 2\n.ends gain_two\n";

async function dividerWithBoundAmplifier() {
  const imported = await importSpiceSources(
    [{ path: "divider.spi", bytes: new TextEncoder().encode(dividerDeck) }],
    "divider.spi",
  );
  if (!imported.project) throw new Error(JSON.stringify(imported.diagnostics));
  const project = edit(imported.project, [
    {
      kind: "apply_model_source",
      source: {
        id: "gain-source",
        language: "spice",
        entry: "gain.spi",
        revision: 0,
        files: [{ path: "gain.spi", text: gainModel }],
        dependencies: [],
      },
      definitions: [{ definitionId: "gain", entry: "gain_two" }],
    },
  ]);
  const withAmplifier = editTop(project, [
    {
      kind: "add_instance",
      instance: {
        id: "amp",
        symbolId: "opamp",
        reference: "XAMP",
        placement: null,
        netlist: {
          parameters: {},
          binding: { kind: "unresolved-subcircuit", name: "opamp" },
        },
      },
    },
  ]);
  return edit(
    withAmplifier,
    planSetDeviceModelTarget(
      withAmplifier,
      withAmplifier.topDocumentId,
      "amp",
      "gain_two",
    ),
  );
}

function wireAmplifier(project: CircuitProject, swapped: boolean) {
  const document = project.documents.find(
    ({ id }) => id === project.topDocumentId,
  )!;
  const terminal = (reference: string, pinName: string) => ({
    kind: "terminal" as const,
    instanceId: document.instances.find(
      (instance) => instance.reference === reference,
    )!.id,
    pinName,
  });
  return editTop(project, [
    {
      kind: "connect_endpoints",
      from: terminal("XDIV", "MID"),
      to: terminal("XAMP", swapped ? "IN-" : "IN+"),
    },
    {
      kind: "connect_endpoints",
      from: terminal("V2", "+"),
      to: terminal("XAMP", swapped ? "IN+" : "IN-"),
    },
    {
      kind: "connect_endpoints",
      from: terminal("RL", "1"),
      to: terminal("XAMP", "OUT"),
    },
  ]);
}

export async function pinOrderOpProject(swapped = false) {
  return wireAmplifier(await dividerWithBoundAmplifier(), swapped);
}
