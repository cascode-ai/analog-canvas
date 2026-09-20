import { readFileSync } from "node:fs";
import {
  createEmptyProject,
  createEmptyDocument,
  createRoutePath,
  type CircuitProject,
} from "@icm/model";
import { executeProjectTransaction } from "@icm/edit-engine";
import { parseProject } from "@icm/project-protocol";
import {
  externalSubcircuitSymbolId,
  hierarchicalSymbolId,
  builtInSymbols,
  InMemorySymbolResolver,
} from "@icm/symbols";
import { describe, it, expect } from "vitest";
import { EditorDocumentController } from "../../document/document-controller";
import { resolveDocumentLogicalNets } from "@icm/derived";
import {
  captureProjectCopy,
  planProjectCopyPlacement,
  prepareProjectCopy,
} from "./project-copy";
import {
  clipboardPreviewDocument,
  orientClipboard,
  type SchematicClipboard,
} from "./clipboard";

const selection = (instanceIds: string[] = [], routeIds: string[] = []) => ({
  instanceIds,
  routeIds,
  junctionIds: [],
  annotationIds: [],
  draftingIds: [],
});
function place(
  project: CircuitProject,
  clipboard: SchematicClipboard,
  sequence = 1,
) {
  const plan = planProjectCopyPlacement(
    project,
    project.documents[0]!,
    clipboard,
    { x: 4000 * sequence, y: 0 },
    sequence,
  );
  const result = executeProjectTransaction(project, {
    transactionId: `copy-${sequence}`,
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    actor: { kind: "human", id: "test" },
    edits: plan.edits,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.project;
}
function externalFixture() {
  const source = createEmptyProject("source", "Source");
  source.externalSubcircuitDefinitions.push({
    id: "external-a",
    name: "amp",
    terminals: [{ id: "a-in", name: "IN", direction: "input" }],
    formalParameters: [],
    interfaceStatus: "declared",
  });
  source.documents[0]!.instances.push({
    id: "X1",
    reference: "X1",
    symbolId: externalSubcircuitSymbolId("external-a"),
    placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    netlist: {
      binding: { kind: "external-subcircuit", definitionId: "external-a" },
      parameters: {},
    },
  });
  return source;
}
describe("one Project copy path", () => {
  it("uses the destination bulk default instead of inheriting the source circuit", () => {
    const source = createEmptyProject("source", "Source");
    const document = source.documents[0]!;
    document.instances.push({
      id: "M1",
      symbolId: "nmos",
      placement: { position: { x: 20, y: 20 }, rotation: 0, mirror: "none" },
    });
    document.nets.push({
      id: "substrate",
      terminals: [{ instanceId: "M1", pinName: "S" }],
    });
    document.mosBulkDefaults = { nmosNetId: "substrate" };
    const clipboard = captureProjectCopy(source, document, selection(["M1"]))!;
    expect(clipboard.nets).toEqual([]);
    const target = createEmptyProject("target", "Target");
    target.documents[0]!.nets.push({ id: "different-bulk", terminals: [] });
    target.documents[0]!.mosBulkDefaults = { nmosNetId: "different-bulk" };
    const result = place(target, clipboard);
    const copied = result.documents[0]!.instances[0]!;
    expect(copied.mosBulkBinding?.origin).toBe("cell-default");
    expect(copied.mosBulkBinding?.netId).toBe("different-bulk");
    expect(
      result.documents[0]!.nets.find(
        (net) => net.id === copied.mosBulkBinding?.netId,
      )?.terminals,
    ).toContainEqual({ instanceId: copied.id, pinName: "B" });
    expect(document.nets[0]!.terminals).toEqual([
      { instanceId: "M1", pinName: "S" },
    ]);
  });

  it("inserts fresh repeated devices without source names, aliases or outside connections", () => {
    const project = createEmptyProject("copy-source", "Copy source");
    const document = project.documents[0]!;
    const original = {
      id: "source-mos",
      reference: "M99",
      symbolId: "nmos",
      symbolVariantId: "textbook-3terminal",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 90 as const,
        mirror: "horizontal" as const,
      },
      styleOverride: { foreground: "#ff0000" },
      netlist: {
        binding: {
          kind: "model" as const,
          deviceClass: "mos" as const,
          name: "NMOS",
        },
        parameters: { w: "4u", l: "180n", m: "3" },
      },
      importProvenance: {
        kind: "model" as const,
        sourceMasterName: "NMOS",
        sourceTarget: "original.cir",
      },
      mosBulkBinding: {
        origin: "instance-override" as const,
        netId: "body-bias",
      },
    };
    document.instances.push(original);
    document.nets.push(
      {
        id: "body-bias",
        terminals: [{ instanceId: original.id, pinName: "B" }],
      },
      { id: "signal", terminals: [{ instanceId: original.id, pinName: "D" }] },
    );
    document.connectivityEvidence.push({
      id: "source-name",
      kind: "name-claim",
      netId: "signal",
      name: "OLD_OUTPUT",
      scope: "global",
      owner: { kind: "global-declaration", sourceNetId: "signal" },
    });
    document.connectivityEvidence.push({
      id: "source-signal",
      kind: "spice-source",
      netId: "signal",
      sourceNetId: "signal",
    });
    document.annotations.push({
      id: "custom-label",
      kind: "instance-label",
      content: { runs: [{ kind: "text", value: "Old alias" }] },
      anchor: {
        kind: "object",
        objectId: original.id,
        localOffset: { x: 20, y: 0 },
        fallbackPosition: { x: 120, y: 100 },
      },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    const before = structuredClone(project);
    const clipboard = captureProjectCopy(
      project,
      document,
      selection([original.id]),
    )!;
    expect(clipboard.nets).toEqual([]);
    const once = place(project, clipboard);
    const twice = place(once, clipboard, 2);
    const copies = twice.documents[0]!.instances.filter(
      (instance) => instance.id !== original.id,
    );
    expect(copies.map((instance) => instance.reference)).toEqual(["M1", "M2"]);
    for (const copy of copies) {
      expect(copy).toMatchObject({
        symbolId: original.symbolId,
        symbolVariantId: original.symbolVariantId,
        netlist: original.netlist,
        styleOverride: original.styleOverride,
        placement: { rotation: 90, mirror: "horizontal" },
      });
      expect(copy.mosBulkBinding).toBeUndefined();
      expect(copy.importProvenance).toBeUndefined();
      expect(
        twice.documents[0]!.nets.flatMap((net) => net.terminals).some(
          (terminal) => terminal.instanceId === copy.id,
        ),
      ).toBe(false);
      expect(
        twice.documents[0]!.annotations.find(
          (annotation) =>
            annotation.anchor.kind === "object" &&
            annotation.anchor.objectId === copy.id,
        ),
      ).toMatchObject({
        binding: { kind: "instance-reference", instanceId: copy.id },
      });
    }
    expect(project).toEqual(before);
  });

  it("connects a copied pin at its destination using Insert contact rules", () => {
    const source = createEmptyProject("source", "Source");
    source.documents[0]!.instances.push({
      id: "R9",
      reference: "R9",
      symbolId: "resistor",
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      netlist: { parameters: { value: "2k" } },
    });
    const resolver = new InMemorySymbolResolver(builtInSymbols);
    const pin = resolver.resolve("resistor")!.definition.pins[0]!;
    const port = resolver.resolve("port")!.definition.pins[0]!;
    const target = createEmptyProject("target", "Target");
    const document = target.documents[0]!;
    document.instances.push({
      id: "P1",
      symbolId: "port",
      placement: {
        position: { x: 4000 + pin.at.x - port.at.x, y: pin.at.y - port.at.y },
        rotation: 0,
        mirror: "none",
      },
    });
    document.nets.push({
      id: "destination",
      terminals: [{ instanceId: "P1", pinName: "P" }],
    });
    document.netlist!.terminals.push({
      id: "output",
      name: "OUT",
      netId: "destination",
      direction: "output",
      interfaceInstanceIds: ["P1"],
    });
    const clipboard = captureProjectCopy(
      source,
      source.documents[0]!,
      selection(["R9"]),
    )!;
    const copied = place(target, clipboard).documents[0]!;
    const instance = copied.instances.find(
      (candidate) => candidate.symbolId === "resistor",
    )!;
    expect(instance.reference).toBe("R1");
    expect(
      copied.nets.find((net) =>
        net.terminals.some((terminal) => terminal.instanceId === "P1"),
      )?.terminals,
    ).toContainEqual({ instanceId: instance.id, pinName: pin.name });
  });

  it("preserves copied Port names while allocating distinct Base Nets", () => {
    const project = createEmptyProject("ports", "Ports");
    const document = project.documents[0]!;
    document.instances.push(
      ...["P1", "P2"].map((id, index) => ({
        id,
        symbolId: "port",
        placement: {
          position: { x: 100 * index, y: 0 },
          rotation: 0 as const,
          mirror: "none" as const,
        },
      })),
    );
    document.nets.push({
      id: "shared",
      terminals: document.instances.map((instance) => ({
        instanceId: instance.id,
        pinName: "P",
      })),
    });
    document.netlist!.terminals.push(
      ...["P1", "P2"].map((id) => ({
        id: `input-${id}`,
        name: "OLD_INPUT",
        netId: "shared",
        direction: "input" as const,
        interfaceInstanceIds: [id],
      })),
    );
    const copied = place(
      project,
      captureProjectCopy(project, document, selection(["P1", "P2"]))!,
    ).documents[0]!;
    const terminals = copied.netlist!.terminals.filter((terminal) =>
      terminal.interfaceInstanceIds.some((id) => id !== "P1" && id !== "P2"),
    );
    expect(terminals.map((terminal) => terminal.name)).toEqual([
      "OLD_INPUT",
      "OLD_INPUT",
    ]);
    expect(new Set(terminals.map((terminal) => terminal.netId)).size).toBe(2);
    expect(terminals.every((terminal) => terminal.netId !== "shared")).toBe(
      true,
    );
  });

  it("uses the Insert supply name instead of silently reconnecting a copied AVDD marker", () => {
    const project = createEmptyProject("supplies", "Supplies");
    const document = project.documents[0]!;
    document.instances.push({
      id: "VDD1",
      symbolId: "vdd-port",
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    });
    document.nets.push({
      id: "analog-supply",
      terminals: [{ instanceId: "VDD1", pinName: "P" }],
    });
    document.connectivityEvidence.push({
      id: "analog-name",
      kind: "name-claim",
      netId: "analog-supply",
      name: "AVDD",
      scope: "global",
      powerDomain: "vdd",
      owner: { kind: "power-marker", objectId: "VDD1" },
    });
    const copied = place(
      project,
      captureProjectCopy(project, document, selection(["VDD1"]))!,
    ).documents[0]!;
    const logical = resolveDocumentLogicalNets(copied);
    expect(logical.groups.map((group) => group.name).sort()).toEqual([
      "AVDD",
      "VDD",
    ]);
    const copy = copied.instances.find((instance) => instance.id !== "VDD1")!;
    const net = copied.nets.find((candidate) =>
      candidate.terminals.some((terminal) => terminal.instanceId === copy.id),
    )!;
    expect(logical.byBaseNetId.get(net.id)?.name).toBe("VDD");
  });

  it("undoes dependencies and placed objects together, with no writes from preparation", () => {
    const source = externalFixture();
    const controller = new EditorDocumentController(
      createEmptyProject("target", "Target"),
    );
    const clipboard = captureProjectCopy(source, source.documents[0]!)!;
    prepareProjectCopy(controller.project, controller.document, clipboard);
    expect(controller.canUndo).toBe(false);
    const plan = planProjectCopyPlacement(
      controller.project,
      controller.document,
      clipboard,
      { x: 400, y: 0 },
      1,
    );
    expect(
      controller.dispatchProjectTransaction({
        transactionId: "paste",
        projectId: controller.project.id,
        expectedStructureRevision: controller.project.structureRevision,
        actor: { kind: "human", id: "test" },
        edits: plan.edits,
      }).ok,
    ).toBe(true);
    expect(controller.project.externalSubcircuitDefinitions).toHaveLength(1);
    expect(controller.transact([{ kind: "undo" }]).ok).toBe(true);
    expect(controller.document.instances).toEqual([]);
    expect(controller.project.externalSubcircuitDefinitions).toEqual([]);
    expect(controller.transact([{ kind: "redo" }]).ok).toBe(true);
    expect(controller.document.instances).toHaveLength(1);
    expect(controller.project.externalSubcircuitDefinitions).toHaveLength(1);
  });

  it("detaches a text-only external anchor at its resolved position, not its stale fallback", () => {
    const source = createEmptyProject("source", "Source");
    const doc = source.documents[0]!;
    doc.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
    });
    doc.drafting = {
      objects: [
        {
          id: "text",
          kind: "text",
          locked: false,
          zIndex: 0,
          content: { runs: [{ kind: "text", value: "note" }] },
          alignment: "start",
          rotation: 0,
          anchor: {
            kind: "object",
            objectId: "R1",
            localOffset: { x: 20, y: 30 },
            fallbackPosition: { x: -999, y: -999 },
          },
        },
      ],
    };
    const clipboard = captureProjectCopy(source, doc, {
      ...selection(),
      draftingIds: ["text"],
    })!;
    expect(clipboard.draftingObjects[0]!.anchor).toEqual({
      kind: "free",
      position: { x: 120, y: 130 },
    });
    const target = place(createEmptyProject("target", "Target"), clipboard);
    expect(target.documents[0]!.instances).toEqual([]);
    expect(target.documents[0]!.drafting!.objects[0]!.anchor).toEqual({
      kind: "free",
      position: { x: 4120, y: 130 },
    });
  });

  it("keeps named copied Nets connected by name while leaving target physical routes unchanged", () => {
    const source = createEmptyProject("source", "Source");
    const doc = source.documents[0]!;
    doc.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
    });
    doc.nets.push({ id: "n", terminals: [{ instanceId: "R1", pinName: "1" }] });
    doc.connectivityEvidence.push({
      id: "claim",
      kind: "name-claim",
      netId: "n",
      name: "AVDD",
      scope: "global",
      powerDomain: "vdd",
      owner: { kind: "global-declaration", sourceNetId: "n" },
    });
    doc.connectivityEvidence.push({
      id: "source-net",
      kind: "spice-source",
      netId: "n",
      sourceNetId: "n",
    });
    const clipboard = captureProjectCopy(source, doc)!;
    const copied = place(source, clipboard);
    const logical = resolveDocumentLogicalNets(
      copied.documents[0]!,
    ).groups.find((g) => g.name === "AVDD")!;
    expect(logical.baseNetIds).toHaveLength(2);
    expect(copied.documents[0]!.routes).toEqual(doc.routes);
  });
  it("copies a real SKY130 Gallery scene and its referenced definitions atomically, twice", () => {
    const source = parseProject(
      readFileSync(
        "apps/editor/src/examples/simulation-common-source.icproj.json",
        "utf8",
      ),
    );
    const before = structuredClone(source);
    const target = createEmptyProject("target", "Target");
    const clipboard = captureProjectCopy(
      source,
      source.documents.find((d) => d.id === source.topDocumentId)!,
    )!;
    const prepared = prepareProjectCopy(
      target,
      target.documents[0]!,
      clipboard,
    );
    expect(
      prepared.dependencyEdits.some(
        (e) => e.kind === "upsert_external_subcircuit_definition",
      ),
    ).toBe(true);
    const ghost = clipboardPreviewDocument(
      target.documents[0]!,
      prepared.clipboard,
      { x: 0, y: 0 },
      [],
      prepared.resolver,
    );
    expect(ghost.instances.length).toBe(clipboard.instances.length);
    const first = place(target, clipboard);
    const second = place(first, clipboard, 2);
    expect(second.externalSubcircuitDefinitions).toEqual(
      first.externalSubcircuitDefinitions,
    );
    expect(second.documents[0]!.instances).toHaveLength(
      clipboard.instances.length * 2,
    );
    expect(source).toEqual(before);
    expect(target.externalSubcircuitDefinitions).toEqual([]);
  });

  it("resolves generated external symbols in preview and does not confuse equal IDs across Projects", () => {
    const source = externalFixture();
    const target = createEmptyProject("target", "Target");
    target.externalSubcircuitDefinitions.push({
      ...structuredClone(source.externalSubcircuitDefinitions[0]!),
      name: "unrelated",
    });
    const clipboard = captureProjectCopy(
      source,
      source.documents[0]!,
      selection(["X1"]),
    )!;
    const prepared = prepareProjectCopy(
      target,
      target.documents[0]!,
      clipboard,
    );
    const instance = prepared.clipboard.instances[0]!;
    expect(instance.netlist?.binding).not.toEqual(
      source.documents[0]!.instances[0]!.netlist?.binding,
    );
    expect(prepared.resolver.resolve(instance.symbolId)).toBeDefined();
    const copied = place(target, clipboard);
    expect(copied.externalSubcircuitDefinitions).toHaveLength(2);
    expect(copied.externalSubcircuitDefinitions[0]).toEqual(
      target.externalSubcircuitDefinitions[0],
    );
  });

  it("rejects incompatible same-name definitions before writing, and reuses compatible definitions", () => {
    const source = externalFixture();
    const clipboard = captureProjectCopy(source, source.documents[0]!)!;
    const target = createEmptyProject("target", "Target");
    target.externalSubcircuitDefinitions.push({
      ...structuredClone(source.externalSubcircuitDefinitions[0]!),
      id: "target-amp",
    });
    expect(place(target, clipboard).externalSubcircuitDefinitions).toHaveLength(
      1,
    );
    target.externalSubcircuitDefinitions[0]!.terminals[0]!.name = "OUT";
    const before = structuredClone(target);
    expect(() => place(target, clipboard)).toThrow(/incompatible/);
    expect(target).toEqual(before);
  });

  it("uses the same capture for C, retaining shared definitions and internal wires", () => {
    const source = externalFixture();
    const copied = place(
      source,
      captureProjectCopy(source, source.documents[0]!, selection(["X1"]))!,
    );
    expect(copied.externalSubcircuitDefinitions).toEqual(
      source.externalSubcircuitDefinitions,
    );
    expect(copied.documents[0]!.instances).toHaveLength(2);
  });

  it("keeps hierarchy, imports only referenced Cells, and versions changed source definitions", () => {
    const source = createEmptyProject("source", "Source");
    const child = createEmptyDocument("child", "Amplifier");
    child.instances.push({ id: "R1", symbolId: "resistor", placement: null });
    source.documents.push(child, createEmptyDocument("unused", "Unused"));
    source.documents[0]!.instances.push({
      id: "X1",
      reference: "X1",
      symbolId: hierarchicalSymbolId(child.name),
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      netlist: {
        binding: { kind: "subcircuit", childDocumentId: child.id },
        parameters: {},
      },
    });
    const clipboard = captureProjectCopy(source, source.documents[0]!)!;
    expect(clipboard.context?.documents).toHaveLength(1);
    const first = place(createEmptyProject("target", "Target"), clipboard);
    const second = place(first, clipboard, 2);
    expect(second.documents).toHaveLength(2);
    child.instances.push({ id: "C1", symbolId: "capacitor", placement: null });
    const changed = place(
      second,
      captureProjectCopy(source, source.documents[0]!)!,
      3,
    );
    expect(changed.documents).toHaveLength(3);
  });

  it("copies an attached Wire and current marker without importing its unselected devices", () => {
    const source = createEmptyProject("source", "Source");
    const doc = source.documents[0]!;
    doc.instances.push(
      ...[100, 220].map((x, i) => ({
        id: `R${i + 1}`,
        symbolId: "resistor",
        placement: {
          position: { x, y: 100 },
          rotation: 0 as const,
          mirror: "none" as const,
        },
      })),
    );
    doc.nets.push({
      id: "n",
      terminals: [
        { instanceId: "R1", pinName: "2" },
        { instanceId: "R2", pinName: "1" },
      ],
    });
    doc.routes.push(
      createRoutePath({
        id: "wire",
        netId: "n",
        start: { kind: "terminal", instanceId: "R1", pinName: "2" },
        end: { kind: "terminal", instanceId: "R2", pinName: "1" },
        bends: [],
        modes: ["manual"],
      }),
    );
    doc.annotations.push({
      id: "arrow",
      kind: "route-marker",
      markerKind: "current",
      content: { runs: [{ kind: "text", value: "I" }] },
      anchor: {
        kind: "route",
        routeId: "wire",
        legId: doc.routes[0]!.legs[0]!.id,
        t: 0.5,
        normalOffset: 0,
        direction: "forward",
        orientation: "follow",
        fallbackPosition: { x: 160, y: 100 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });
    doc.annotations.push({
      id: "outside-label",
      kind: "net-label",
      netId: "n",
      binding: { kind: "net-name", netId: "n" },
      anchor: { kind: "free", position: { x: 800, y: 800 } },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    doc.connectivityEvidence.push({
      id: "outside-name",
      kind: "name-claim",
      netId: "n",
      name: "OLD_SIGNAL",
      scope: "local",
      owner: { kind: "net-label", annotationId: "outside-label" },
    });
    expect(
      captureProjectCopy(source, doc, selection(["R1", "R2"]))?.routes,
    ).toHaveLength(0);
    expect(
      captureProjectCopy(source, doc, selection(["R1", "R2"], ["wire"]))
        ?.routes,
    ).toHaveLength(1);
    const fragment = captureProjectCopy(source, doc, selection([], ["wire"]))!;
    expect(fragment.connectivityEvidence).toEqual([]);
    expect(
      fragment.annotations.some(
        (annotation) => annotation.id === "outside-label",
      ),
    ).toBe(false);
    expect(fragment.instances).toEqual([]);
    expect(fragment.junctions).toHaveLength(2);
    const copied = place(
      createEmptyProject("target", "Target"),
      orientClipboard(fragment, [{ kind: "rotate", deltaDegrees: 90 }]),
    );
    expect(copied.documents[0]!.routes).toHaveLength(1);
    expect(copied.documents[0]!.annotations[0]!.anchor).toMatchObject({
      kind: "route",
      routeId: copied.documents[0]!.routes[0]!.id,
      legId: copied.documents[0]!.routes[0]!.legs[0]!.id,
    });
  });

  it("carries Cell parameters for partial copies, refuses conflicting defaults and incompatible appearance", () => {
    const source = externalFixture();
    source.documents[0]!.netlist!.formalParameters.push({
      name: "gain",
      defaultValue: "10",
    });
    const fragment = captureProjectCopy(
      source,
      source.documents[0]!,
      selection(["X1"]),
    )!;
    const target = createEmptyProject("target", "Target");
    expect(
      place(target, fragment).documents[0]!.netlist!.formalParameters,
    ).toEqual([{ name: "gain", defaultValue: "10" }]);
    target.documents[0]!.netlist!.formalParameters.push({
      name: "gain",
      defaultValue: "20",
    });
    expect(() => place(target, fragment)).toThrow(/incompatible defaults/);
    target.documents[0]!.presentation.styleOverrides = { symbolStrokeScale: 2 };
    expect(() => place(target, fragment)).toThrow(/preserve appearance/);
  });
});
