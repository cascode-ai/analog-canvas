import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createEmptyProject,
  createEmptyDocument,
  createRoutePath,
  type CircuitProject,
} from "@icm/model";
import { parseProject, serializeProject } from "@icm/project-protocol";
import { compareElectricalGraphs, projectElectricalGraph } from "@icm/netlist";
import {
  withProjectComponentDefinitions,
  builtInSymbols,
  hierarchicalSymbolId,
  createProjectSymbolResolver,
} from "@icm/symbols";
import {
  resolveDocumentRoutingGeometry,
  resolveDocumentLogicalNets,
} from "@icm/derived";
import { EditorDocumentController } from "../../document/document-controller";
import {
  createSelectionPolicy,
  DEFAULT_SELECTION_FILTER,
} from "../selection/selection-filter";
import {
  decodeCircuitClipboard,
  encodeCircuitClipboard,
} from "./system-clipboard";
import {
  applyProjectCopyPlacement,
  planProjectCopyPlacement,
} from "./project-copy";

function text(project: CircuitProject) {
  const document = project.documents.find(
    (item) => item.id === project.topDocumentId,
  )!;
  return encodeCircuitClipboard(
    project,
    document,
    createSelectionPolicy(document, DEFAULT_SELECTION_FILTER).selectAll(),
  )!;
}
function paste(project: CircuitProject, content: string, sequence = 1) {
  const document = project.documents.find(
    (item) => item.id === project.topDocumentId,
  )!;
  return applyProjectCopyPlacement(
    planProjectCopyPlacement(
      project,
      document,
      decodeCircuitClipboard(content)!,
      { x: 2000 * sequence, y: 0 },
      sequence,
    ),
  );
}
function fixture(name: string) {
  return parseProject(
    readFileSync(`apps/editor/src/examples/${name}.icproj.json`, "utf8"),
  );
}
// Compare occupied conductor geometry even when contact normalization splits a route.
function wireSegments(project: CircuitProject, offsetX = 0) {
  const document = project.documents.find(
    (item) => item.id === project.topDocumentId,
  )!;
  const geometry = resolveDocumentRoutingGeometry(
    document,
    createProjectSymbolResolver(project, builtInSymbols),
  );
  const segments = new Set<string>();
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  for (const route of geometry.routes.values()) {
    for (let index = 1; index < route.centerline.length; index++) {
      const a = route.centerline[index - 1]!,
        b = route.centerline[index]!;
      const dx = b.x - a.x,
        dy = b.y - a.y,
        steps = gcd(Math.abs(dx), Math.abs(dy));
      for (let part = 0; part < steps; part++) {
        const ends = [
          [a.x + (dx * part) / steps - offsetX, a.y + (dy * part) / steps],
          [
            a.x + (dx * (part + 1)) / steps - offsetX,
            a.y + (dy * (part + 1)) / steps,
          ],
        ].sort((left, right) => left[0]! - right[0]! || left[1]! - right[1]!);
        segments.add(JSON.stringify(ends));
      }
    }
  }
  return [...segments].sort();
}
function electricalEqual(a: CircuitProject, b: CircuitProject) {
  const left = projectElectricalGraph(a),
    right = projectElectricalGraph(b);
  expect(left.status).toBe("ready");
  expect(right.status).toBe("ready");
  if (left.status === "ready" && right.status === "ready")
    expect(compareElectricalGraphs(left.graph, right.graph)).toBe("equal");
}

describe("portable system circuit clipboard", () => {
  it.each(["simulation-common-source", "five-transistor-ota-sky130"])(
    "preserves %s electrical structure, parameters and source text across Projects and save/reopen",
    (name) => {
      const source = fixture(name);
      const before = structuredClone(source);
      const content = text(source);
      const target = createEmptyProject("target", "Destination");
      const copied = paste(target, content);
      electricalEqual(source, copied);
      electricalEqual(source, parseProject(serializeProject(copied)));
      const sourceDocument = source.documents.find(
        (item) => item.id === source.topDocumentId,
      )!;
      expect(
        copied.documents[0]!.instances.map((item) => [
          item.reference,
          item.netlist?.parameters,
        ]),
      ).toEqual(
        sourceDocument.instances.map((item) => [
          item.reference,
          item.netlist?.parameters,
        ]),
      );
      expect(wireSegments(copied, 2000)).toEqual(wireSegments(source));
      expect(
        copied.simulationFolders.map((folder) => folder.input.files),
      ).toEqual(
        source.simulationFolders
          .filter(
            (folder) =>
              folder.input.circuitBindings.length > 0 &&
              folder.input.circuitBindings.every(
                (binding) => binding.documentId === source.topDocumentId,
              ),
          )
          .map((folder) => folder.input.files),
      );
      for (const folder of copied.simulationFolders)
        for (const binding of folder.input.circuitBindings)
          expect(
            copied.documents.some(
              (document) => document.id === binding.documentId,
            ),
          ).toBe(true);
      expect(source).toEqual(before);
      expect(target.documents[0]!.instances).toEqual([]);
      // Repeated placement cannot reuse object identity or overwrite model sources.
      const twice = paste(copied, content, 2);
      const ids = twice.documents[0]!.instances.map((item) => item.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(twice.simulationFolders).toEqual(copied.simulationFolders);
    },
  );

  it("carries only selected components and wires, preserving names, bulk, NoConnect and cut endpoints", () => {
    const source = createEmptyProject("source", "Partial");
    const document = source.documents[0]!;
    for (const [id, x] of [
      ["R7", 100],
      ["R8", 300],
    ] as const)
      document.instances.push({
        id,
        reference: id,
        symbolId: "resistor",
        placement: { position: { x, y: 100 }, rotation: 0, mirror: "none" },
        netlist: {
          parameters: { value: "13k" },
          binding: { kind: "primitive", deviceClass: "resistor" },
        },
      });
    document.nets.push({
      id: "signal",
      terminals: [
        { instanceId: "R7", pinName: "2" },
        { instanceId: "R8", pinName: "1" },
      ],
    });
    document.routes.push({
      ...createRoutePath({
        id: "wire",
        netId: "signal",
        start: { kind: "terminal", instanceId: "R7", pinName: "2" },
        end: { kind: "terminal", instanceId: "R8", pinName: "1" },
        bends: [],
        modes: ["manual"],
      }),
    });
    document.noConnects.push({
      id: "open",
      endpoint: { kind: "terminal", instanceId: "R7", pinName: "1" },
      reason: "intentional",
    });
    document.connectivityEvidence.push({
      id: "claim",
      kind: "name-claim",
      netId: "signal",
      name: "BIAS",
      scope: "global",
      owner: { kind: "global-declaration", sourceNetId: "signal" },
    });
    document.connectivityEvidence.push({
      id: "source-net",
      kind: "spice-source",
      netId: "signal",
      sourceNetId: "signal",
    });
    const content = encodeCircuitClipboard(source, document, {
      instanceIds: ["R7"],
      routeIds: ["wire"],
      junctionIds: [],
      annotationIds: [],
      draftingIds: [],
    })!;
    const copied = paste(createEmptyProject("target", "Target"), content)
      .documents[0]!;
    expect(copied.instances).toHaveLength(1);
    expect(copied.instances[0]!.reference).toBe("R7");
    expect(copied.instances[0]!.netlist?.parameters).toEqual({ value: "13k" });
    expect(copied.noConnects[0]?.reason).toBe("intentional");
    expect(copied.routes).toHaveLength(1);
    expect(
      copied.nets
        .flatMap((net) => net.terminals)
        .every((terminal) => terminal.instanceId === copied.instances[0]!.id),
    ).toBe(true);
    expect(
      copied.connectivityEvidence.some(
        (item) => item.kind === "name-claim" && item.name === "BIAS",
      ),
    ).toBe(true);
  });

  it("isolates different same-ID custom definitions and restores dependencies with undo/redo", () => {
    let source = createEmptyProject("source", "Custom");
    source.documents[0]!.instances.push({
      id: "R17",
      reference: "R17",
      symbolId: "resistor",
      placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
      netlist: { parameters: { value: "7k" } },
    });
    source = withProjectComponentDefinitions(source);
    source.componentDefinitions![0]!.symbol.name = "Authored resistor";
    let target = createEmptyProject("target", "Target");
    target.documents[0]!.instances.push({
      ...structuredClone(source.documents[0]!.instances[0]!),
      id: "existing",
    });
    target = withProjectComponentDefinitions(target);
    const controller = new EditorDocumentController(target);
    const before = structuredClone(controller.project);
    const result = paste(controller.project, text(source));
    expect(result.documents[0]!.instances[1]!.symbolId).not.toBe("resistor");
    expect(result.documents[0]!.instances[1]!.reference).not.toBe("R17");
    expect(
      result.componentDefinitions!.find(
        (item) =>
          item.symbol.id === result.documents[0]!.instances[1]!.symbolId,
      )?.symbol.name,
    ).toBe("Authored resistor");
    expect(
      result.componentDefinitions!.find(
        (item) => item.symbol.id === "resistor",
      ),
    ).toEqual(before.componentDefinitions![0]);
    controller.commitProjectStructure(result);
    controller.transact([{ kind: "undo" }]);
    expect(controller.project).toEqual({
      ...before,
      structureRevision: controller.project.structureRevision,
      documents: before.documents.map((document) => ({
        ...document,
        revision: controller.project.documents.find(
          (item) => item.id === document.id,
        )!.revision,
      })),
    });
    controller.transact([{ kind: "redo" }]);
    expect(controller.project.documents[0]!.instances).toHaveLength(2);
    expect(controller.project.componentDefinitions).toHaveLength(2);
  });

  it("imports nested Cells and their custom definitions without unrelated Project content", () => {
    let source = createEmptyProject("source", "Hierarchy");
    const child = createEmptyDocument("child", "Child");
    const grandchild = createEmptyDocument("grandchild", "Amplifier");
    grandchild.instances.push({
      id: "R1",
      reference: "R1",
      symbolId: "resistor",
      placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
      netlist: { parameters: { value: "22k" } },
    });
    const block = (id: string, target: typeof child) => ({
      id,
      reference: id,
      symbolId: hierarchicalSymbolId(target.name),
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
      netlist: {
        binding: { kind: "subcircuit" as const, childDocumentId: target.id },
        parameters: {},
      },
    });
    child.instances.push(block("X2", grandchild));
    source.documents[0]!.instances.push(block("X1", child));
    source.documents.push(
      child,
      grandchild,
      createEmptyDocument("private", "Unrelated private work"),
    );
    source = withProjectComponentDefinitions(source);
    source.componentDefinitions!.find(
      (definition) => definition.symbol.id === "resistor",
    )!.symbol.name = "Nested custom resistor";
    const content = text(source);
    expect(content).not.toContain("Unrelated private work");
    const target = paste(createEmptyProject("target", "Target"), content);
    expect(target.documents).toHaveLength(3);
    const custom = target.componentDefinitions!.find(
      (definition) => definition.symbol.name === "Nested custom resistor",
    )!;
    expect(custom).toBeDefined();
    const leaf = target.documents.find((document) =>
      document.instances.some(
        (instance) => instance.symbolId === custom.symbol.id,
      ),
    )!;
    expect(leaf.instances[0]!.netlist?.parameters).toEqual({ value: "22k" });
    expect(paste(target, content, 2).documents).toHaveLength(3);
  });

  it("isolates colliding local net names while preserving explicit global supplies", () => {
    const source = createEmptyProject("source", "Signals");
    const document = source.documents[0]!;
    document.instances.push({
      id: "R1",
      reference: "R1",
      symbolId: "resistor",
      placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
      netlist: { parameters: { value: "1k" } },
    });
    document.nets.push({
      id: "n",
      terminals: [{ instanceId: "R1", pinName: "1" }],
    });
    document.annotations.push({
      id: "label",
      kind: "net-label",
      netId: "n",
      binding: { kind: "net-name", netId: "n" },
      anchor: { kind: "free", position: { x: 80, y: 80 } },
      rotation: 0,
      alignment: "start",
      locked: false,
    });
    document.connectivityEvidence.push({
      id: "name",
      kind: "name-claim",
      netId: "n",
      name: "OUT",
      scope: "local",
      owner: { kind: "net-label", annotationId: "label" },
    });
    const target = paste(source, text(source));
    const groups = resolveDocumentLogicalNets(target.documents[0]!).groups;
    expect(groups.find((group) => group.name === "OUT")?.baseNetIds).toEqual([
      "n",
    ]);
    const copyGroup = groups.find((group) => group.name === "OUT_copy1")!;
    expect(copyGroup).toBeDefined();
    expect(copyGroup.baseNetIds).not.toContain("n");
    const again = paste(target, text(source), 2);
    expect(
      resolveDocumentLogicalNets(again.documents[0]!).groups.some(
        (group) => group.name === "OUT_copy2",
      ),
    ).toBe(true);
    document.instances[0]!.netlist!.parameters.value = "{V(OUT)}";
    expect(() => paste(target, text(source))).toThrow(/behavioral expressions/);
    document.instances[0]!.netlist!.parameters.value = "1k";
    const claim = document.connectivityEvidence[0]!;
    if (claim.kind === "name-claim") {
      claim.name = "AVDD";
      claim.scope = "global";
      claim.powerDomain = "vdd";
    }
    const globalCopy = paste(source, text(source));
    expect(
      resolveDocumentLogicalNets(globalCopy.documents[0]!).groups.find(
        (group) => group.name === "AVDD",
      )?.baseNetIds,
    ).toHaveLength(2);
  });

  it.each(["junction", "label"])(
    "copies a standalone %s without unrelated devices",
    (kind) => {
      const source = createEmptyProject("source", "Nodes");
      const document = source.documents[0]!;
      document.instances.push({
        id: "R1",
        reference: "R1",
        symbolId: "resistor",
        placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      });
      document.nets.push({ id: "n", terminals: [] });
      document.junctions.push({
        id: "j",
        netId: "n",
        position: { x: 100, y: 100 },
        role: "route-anchor",
      });
      document.annotations.push({
        id: "label",
        kind: "net-label",
        netId: "n",
        binding: { kind: "net-name", netId: "n" },
        anchor: { kind: "free", position: { x: 100, y: 80 } },
        rotation: 0,
        alignment: "start",
        locked: false,
      });
      document.connectivityEvidence.push({
        id: "name",
        kind: "name-claim",
        netId: "n",
        name: "BIAS",
        scope: "local",
        owner: { kind: "net-label", annotationId: "label" },
      });
      const content = encodeCircuitClipboard(source, document, {
        instanceIds: [],
        draftingIds: [],
        routeIds: [],
        junctionIds: kind === "junction" ? ["j"] : [],
        annotationIds: kind === "label" ? ["label"] : [],
      })!;
      const copied = paste(createEmptyProject("target", "Target"), content)
        .documents[0]!;
      expect(copied.instances).toEqual([]);
      expect(
        resolveDocumentLogicalNets(copied).groups.some(
          (net) => net.name === "BIAS",
        ),
      ).toBe(true);
    },
  );

  it("ignores ordinary text and rejects corrupt, future or dangling payloads", () => {
    expect(decodeCircuitClipboard("R1 in out 1k")).toBeNull();
    const source = fixture("simulation-common-source");
    const content = text(source);
    expect(() => decodeCircuitClipboard(content.slice(0, -5))).toThrow(
      /invalid/,
    );
    const future = JSON.parse(content);
    future.version = 999;
    expect(() => decodeCircuitClipboard(JSON.stringify(future))).toThrow(
      /version/,
    );
    const broken = JSON.parse(content);
    broken.project.documents[0].instances = [];
    expect(() => decodeCircuitClipboard(JSON.stringify(broken))).toThrow(
      /invalid/,
    );
  });
});

it("appends one fully parameterized transistor to an occupied circuit without changing its existing devices", () => {
  const source = fixture("simulation-common-source");
  const document = source.documents.find(
    (item) => item.id === source.topDocumentId,
  )!;
  const transistor = document.instances.find((item) =>
    item.symbolId.includes("nmos"),
  )!;
  expect(transistor.netlist?.parameters).toBeDefined();
  const fragment = encodeCircuitClipboard(source, document, {
    instanceIds: [transistor.id],
    routeIds: [],
    junctionIds: [],
    annotationIds: [],
    draftingIds: [],
  })!;
  const original = structuredClone(source);
  const result = paste(source, fragment);
  const output = result.documents.find(
    (item) => item.id === source.topDocumentId,
  )!;
  expect(source).toEqual(original);
  expect(output.instances).toHaveLength(document.instances.length + 1);
  for (const item of document.instances)
    expect(
      output.instances.find((candidate) => candidate.id === item.id),
    ).toEqual(item);
  const copied = output.instances.find(
    (item) => !document.instances.some((original) => original.id === item.id),
  )!;
  expect(copied.netlist).toEqual(transistor.netlist);
  expect(copied.reference).not.toEqual(transistor.reference);
  expect(output.routes).toHaveLength(document.routes.length);
});
