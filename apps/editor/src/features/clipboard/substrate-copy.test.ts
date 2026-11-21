import { expect, it } from "vitest";
import {
  executeProjectTransaction,
  planSetDeviceModelTarget,
  proposeWireIntent,
  type ProjectStructureEdit,
} from "@icm/edit-engine";
import { resolveDocumentLogicalNets } from "@icm/derived";
import { createDraftNetlistPreview } from "@icm/netlist";
import { createEmptyProject, type CircuitProject } from "@icm/model";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import {
  applyProjectCopyPlacement,
  planProjectCopyPlacement,
} from "./project-copy";
import {
  decodeCircuitClipboard,
  encodeCircuitClipboard,
} from "./system-clipboard";

function groundedProject(id: string) {
  const project = createEmptyProject(id, id);
  const document = project.documents[0]!;
  const netId = id + "-ground";
  document.instances.push({
    id: "ground",
    symbolId: "ground",
    placement: { position: { x: 0, y: -100 }, rotation: 0, mirror: "none" },
  });
  document.nets.push({
    id: netId,
    terminals: [{ instanceId: "ground", pinName: "0" }],
  });
  document.connectivityEvidence.push({
    id: "ground-name",
    kind: "name-claim",
    netId,
    name: "0",
    scope: "global",
    powerDomain: "ground",
    owner: { kind: "power-marker", objectId: "ground" },
  });
  document.mosBulkDefaults = { nmosNetId: netId };
  return project;
}

function applyStructure(
  project: CircuitProject,
  edits: ProjectStructureEdit[],
) {
  const result = executeProjectTransaction(project, {
    transactionId: "substrate-copy-fixture",
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    actor: { kind: "human", id: "test" },
    edits,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.project;
}

const sky130BjtModels = {
  npn: "sky130_fd_pr__npn_05v5_W1p00L1p00",
  pnp: "sky130_fd_pr__pnp_05v5_W0p68L0p68",
};

function bjtSource(symbolId: keyof typeof sky130BjtModels = "npn") {
  const source = groundedProject("source");
  const document = source.documents[0]!;
  document.instances.push({
    id: "Q1",
    reference: "Q1",
    symbolId,
    placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    netlist: { parameters: {} },
  });
  return applyStructure(
    source,
    planSetDeviceModelTarget(
      source,
      document.id,
      "Q1",
      sky130BjtModels[symbolId],
    ),
  );
}

function pasteBjt(
  source: CircuitProject,
  target: CircuitProject,
  selection: Partial<Parameters<typeof encodeCircuitClipboard>[2]> = {},
) {
  const text = encodeCircuitClipboard(source, source.documents[0]!, {
    instanceIds: ["Q1"],
    routeIds: [],
    junctionIds: [],
    annotationIds: [],
    draftingIds: [],
    ...selection,
  })!;
  const plan = planProjectCopyPlacement(
    target,
    target.documents[0]!,
    decodeCircuitClipboard(text)!,
    { x: 400, y: 0 },
    1,
  );
  const project = applyProjectCopyPlacement(plan);
  return {
    project,
    document: project.documents[0]!,
    id: plan.mapping.objects.instances.Q1!,
  };
}

it("pastes a defaulted NPN substrate onto the destination Cell's ground", () => {
  const source = bjtSource();
  const { document, id } = pasteBjt(source, groundedProject("target"));

  expect(
    document.nets.find((net) => net.id === "target-ground")?.terminals,
  ).toContainEqual({ instanceId: id, pinName: "S" });
});

function withExplicitSubstrate(source: CircuitProject) {
  const netId = "substrate";
  const labelId = "substrate-name";
  return applyStructure(source, [
    {
      kind: "transact_document",
      documentId: source.topDocumentId,
      expectedRevision: source.documents[0]!.revision,
      edits: [
        { kind: "create_base_net", netId },
        {
          kind: "upsert_schematic_annotation",
          annotation: {
            id: labelId,
            kind: "net-label",
            netId,
            anchor: { kind: "free", position: { x: 200, y: 100 } },
            binding: { kind: "net-name", netId },
            alignment: "start",
            rotation: 0,
            locked: false,
          },
        },
        {
          kind: "upsert_connectivity_evidence",
          evidence: {
            id: "explicit-substrate-name",
            kind: "name-claim",
            netId,
            name: "VSUB",
            scope: "global",
            owner: { kind: "net-label", annotationId: labelId },
          },
        },
        {
          kind: "set_property_terminal_net",
          instanceId: "Q1",
          pinName: "S",
          netId,
        },
      ],
    },
  ]);
}

it("asks for an explicit substrate Net in Properties when the Net is left behind", () => {
  const source = withExplicitSubstrate(bjtSource());
  const { project, id } = pasteBjt(source, groundedProject("target"));

  const openSubstrate = createDraftNetlistPreview(project)!.diagnostics.find(
    (item) =>
      item.code === "MISSING_PIN_NET" &&
      item.objectIds.includes(id) &&
      item.message.includes(".S "),
  );
  expect(openSubstrate?.message).toContain("Substrate Net in Properties");
});

it("keeps the explicit substrate on its selected VSUB Net", () => {
  const source = withExplicitSubstrate(bjtSource());
  const { document, id } = pasteBjt(source, groundedProject("target"), {
    annotationIds: ["substrate-name"],
  });

  const net = document.nets.find((net) =>
    net.terminals.some((pin) => pin.instanceId === id && pin.pinName === "S"),
  );
  const logical = resolveDocumentLogicalNets(document);
  expect(logical.byBaseNetId.get(net!.id)?.name).toBe("VSUB");
});

it("copies the PNP collector through its selected wire", () => {
  const source = bjtSource("pnp");
  const document = source.documents[0]!;
  const wire = proposeWireIntent(
    document,
    createProjectSymbolResolver(source, builtInSymbols),
    {
      id: "collector-wire",
      from: {
        kind: "endpoint",
        endpoint: { kind: "terminal", instanceId: "Q1", pinName: "C" },
      },
      to: {
        kind: "endpoint",
        endpoint: { kind: "terminal", instanceId: "ground", pinName: "0" },
      },
    },
  );
  if (typeof wire === "string") throw new Error(wire);
  const wired = applyStructure(source, [
    {
      kind: "transact_document",
      documentId: document.id,
      expectedRevision: document.revision,
      edits: wire.edits,
    },
  ]);
  const target = groundedProject("target");
  const alone = pasteBjt(wired, target);
  expect(
    alone.document.nets.flatMap((net) => net.terminals),
  ).not.toContainEqual({ instanceId: alone.id, pinName: "C" });

  const withWire = pasteBjt(wired, target, {
    instanceIds: ["Q1", "ground"],
    routeIds: wired.documents[0]!.routes.map((route) => route.id),
  });
  const collectorNet = withWire.document.nets.find((net) =>
    net.terminals.some(
      (pin) => pin.instanceId === withWire.id && pin.pinName === "C",
    ),
  );
  expect(collectorNet?.id).toBe(withWire.document.routes[0]!.netId);
});

it("uses a destination substrate default established by the same paste", () => {
  const source = bjtSource();
  const document = source.documents[0]!;
  document.instances.push({
    id: "extra-ground",
    symbolId: "ground",
    placement: { position: { x: 200, y: -100 }, rotation: 0, mirror: "none" },
  });
  document.nets.push({
    id: "other-ground-net",
    terminals: [{ instanceId: "extra-ground", pinName: "0" }],
  });
  document.connectivityEvidence.push({
    id: "other-ground-name",
    kind: "name-claim",
    netId: "other-ground-net",
    name: "0",
    scope: "global",
    powerDomain: "ground",
    owner: { kind: "power-marker", objectId: "extra-ground" },
  });
  const { document: pasted, id } = pasteBjt(
    source,
    createEmptyProject("target", "Target"),
    { instanceIds: ["Q1", "extra-ground"] },
  );

  // The two source Grounds share a name. Only the other marker's Base Net
  // travels, and it establishes the target Cell's first ground.
  const defaultNet = pasted.nets.find(
    (net) => net.id === pasted.mosBulkDefaults?.nmosNetId,
  );
  expect(defaultNet?.terminals).toContainEqual({
    instanceId: id,
    pinName: "S",
  });
});
