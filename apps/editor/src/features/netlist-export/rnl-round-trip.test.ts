import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  resolveAnnotationPresentation,
  resolveAnnotationText,
  resolveDocumentLogicalNets,
  resolveDocumentStyleProfile,
} from "@icm/derived";
import { IDEAL_COMPARATOR_TARGET, subcircuitDescriptor } from "@icm/devices";
import {
  createEmptyProject,
  flattenRichText,
  type CircuitProject,
  type Instance,
} from "@icm/model";
import { createDesignNetlistExport } from "@icm/netlist";
import { parseProject } from "@icm/project-protocol";
import {
  composeOrient,
  createRnlExport,
  rnlBodyPortOrder,
  rnlOrient,
  rnlPlace,
  rnlSymbolFor,
  type RnlSnapshot,
} from "@icm/rnl";
import {
  builtInSymbols,
  cellSymbolPinSlots,
  createProjectSymbolResolver,
} from "@icm/symbols";
import { startCore } from "@rich-netlist/runtime";

import { planRnlImport } from "./rnl-import";
import type { RnlRuntime } from "./rnl-runtime";

// The rnl runtime's own core, in a worker thread: the editor's write and read.
const core = startCore();
afterAll(() => core.terminate());
const runtime: RnlRuntime = {
  // As JSON, this editor's readonly points are the runtime's point arrays.
  write: (request) =>
    core.write(request as unknown as Parameters<typeof core.write>[0]),
  snapshot: (request) =>
    core.snapshot(request) as unknown as Promise<RnlSnapshot>,
};

const example = (name: string): CircuitProject =>
  parseProject(
    readFileSync(
      resolve(import.meta.dirname, `../../examples/${name}.icproj.json`),
      "utf8",
    ),
  );

/** Export as SPICE+RNL, write with the runtime, and import the file it wrote. */
async function roundTrip(
  project: CircuitProject,
  format: "spice" | "spectre" = "spice",
) {
  const exported = createRnlExport(project, { format });
  if (exported.status !== "ready") throw new Error("export blocked");
  const written = await runtime.write({ write: exported.request, svg: false });
  const path = format === "spice" ? "circuit.sp" : "circuit.scs";
  const plan = await planRnlImport({
    inputs: [{ path, bytes: new TextEncoder().encode(written.text) }],
    entryPath: path,
    runtime,
  });
  if (plan.status !== "ready") throw new Error(plan.message);
  return plan;
}

/** What RNL writes for a placed part: its symbol, place and orientation. */
function rnlPart(instance: Instance) {
  const symbol = rnlSymbolFor(instance.symbolId, instance.symbolVariantId);
  const turn = instance.placement ? rnlOrient(instance.placement) : undefined;
  if (!symbol || !turn?.ok) return { symbolId: instance.symbolId };
  return {
    symbol: symbol.symbol,
    at: rnlPlace(instance.placement!.position, turn.orient, symbol.offset),
    orient: composeOrient(turn.orient, symbol.orient),
  };
}

/** Each printed part's card name in its Cell, by its Analog Canvas instance. */
function cardNames(project: CircuitProject) {
  const result = createDesignNetlistExport(project, {
    bodyPortOrder: rnlBodyPortOrder(project),
    includeIr: true,
  });
  if (result.status !== "ready") throw new Error("netlist blocked");
  return result.ir!.cells.flatMap((cell) =>
    cell.instances.map((instance) => ({
      cell: cell.name,
      id: instance.id,
      card: instance.reference,
    })),
  );
}

describe("RNL round trip", () => {
  it.each(
    [
      "simulation-common-source",
      "simulation-rc",
      "simulation-rlc",
      "simulation-ota",
      "five-transistor-ota-sky130",
      "two-stage-op-amp",
    ].flatMap((name) => [[name, "spice"] as const, [name, "spectre"] as const]),
  )("places every part of %s (%s) where it was drawn", async (name, format) => {
    const project = example(name);
    const { project: drawn, diagnostics } = await roundTrip(project, format);
    expect(parseProject(JSON.stringify(drawn))).toBeTruthy();
    const misplaced: string[] = [];
    for (const { cell, id, card } of cardNames(project)) {
      const original = project.documents
        .flatMap((document) => document.instances)
        .find((instance) => instance.id === id);
      if (!original?.placement) continue;
      const document = drawn.documents.find(
        (item) => item.netlist?.name.toLowerCase() === cell.toLowerCase(),
      );
      const part = document?.instances.find(
        (instance) => instance.id.toLowerCase() === card.toLowerCase(),
      );
      // Two variants one RNL symbol draws, one flipped, are one drawing to
      // RNL: an op-amp flipped top to bottom reads back as the variant with
      // its inputs swapped, unflipped.
      const same =
        part?.placement &&
        JSON.stringify(rnlPart(part)) === JSON.stringify(rnlPart(original));
      if (!same)
        misplaced.push(
          `${cell}/${card}: ${JSON.stringify(original.placement)} ${original.symbolId}/${original.symbolVariantId ?? "-"} -> ${JSON.stringify(part?.placement)} ${part?.symbolId}/${part?.symbolVariantId ?? "-"}`,
        );
    }
    expect(misplaced).toEqual([]);
    expect(
      diagnostics
        .filter((item) => item.code.startsWith("RNL_"))
        .map((item) => `${item.code}: ${item.message}`),
    ).toEqual([]);
  });

  it.each(["simulation-rc", "simulation-ota", "simulation-common-source"])(
    "shows %s's names and net labels where it showed them",
    async (name) => {
      const project = example(name);
      const { project: drawn } = await roundTrip(project);
      const cards = new Map(cardNames(project).map((item) => [item.id, item]));
      /** Each shown label by what it shows and where, as text. */
      const shown = (from: CircuitProject, rename: (id: string) => string) =>
        from.documents.flatMap((document) => {
          const resolver = createProjectSymbolResolver(from, builtInSymbols);
          const profile = resolveDocumentStyleProfile(document.presentation);
          const logical = resolveDocumentLogicalNets(document);
          return document.annotations
            .filter(
              (annotation) =>
                annotation.kind === "net-label" ||
                (annotation.kind === "instance-label" &&
                  annotation.binding?.kind === "instance-reference"),
            )
            .map((annotation) => {
              const text = resolveAnnotationText(document, annotation, logical);
              const where = resolveAnnotationPresentation(
                document,
                resolver,
                annotation,
                profile,
              );
              const owner =
                annotation.binding?.kind === "instance-reference"
                  ? rename(annotation.binding.instanceId)
                  : "";
              return `${document.netlist?.name.toLowerCase()} ${annotation.kind} ${owner} ${flattenRichText(text)} at ${Math.round(where.position.x)},${Math.round(where.position.y)} ${where.alignment}`;
            });
        });
      const printed = new Set(
        [...cards.values()].map((item) => item.cell.toLowerCase()),
      );
      const original = shown(project, (id) => cards.get(id)?.card ?? id).filter(
        (line) => printed.has(line.split(" ")[0]!),
      );
      expect(original.length).toBeGreaterThan(0);
      expect(shown(drawn, (id) => id).sort()).toEqual(
        expect.arrayContaining(original.sort()),
      );
    },
  );

  it("reads back rectangles, circles, curves and arrows", async () => {
    const project = example("simulation-rc");
    const document = project.documents.find(
      (item) => item.id === project.topDocumentId,
    )!;
    const free = (x: number, y: number) =>
      ({ kind: "free", position: { x, y } }) as const;
    const base = (id: string, zIndex: number) => ({
      id,
      locked: false,
      zIndex,
      anchor: free(0, 0),
    });
    document.drafting = {
      objects: [
        {
          ...base("back", 0),
          kind: "rectangle",
          center: { x: 500, y: -150 },
          width: 160,
          height: 80,
          rotation: 0,
          lineStyle: "dashed",
          layer: "background",
          styleOverride: { fillColor: "#eef4ff" },
        },
        {
          ...base("slanted", 1),
          kind: "rectangle",
          center: { x: 860, y: -150 },
          width: 80,
          height: 40,
          rotation: 30,
          lineStyle: "solid",
        },
        {
          ...base("circle", 2),
          kind: "circle",
          center: { x: 1000, y: -150 },
          radius: 30,
          lineStyle: "dotted",
          styleOverride: { color: "#cc0000" },
        },
        {
          ...base("curve", 3),
          kind: "construction-line",
          points: [
            { x: 400, y: -300 },
            { x: 500, y: -300 },
            { x: 600, y: -250 },
          ],
          curveControls: [null, { x: 580, y: -310 }],
          lineStyle: "dashed",
        },
        {
          ...base("arrow", 4),
          kind: "arrow",
          from: free(400, -400),
          to: free(560, -400),
          styleOverride: { arrowEnd: "medium-arrow" },
        },
      ],
    };
    const { project: drawn } = await roundTrip(project);
    const cell = drawn.documents.find(
      (item) => item.netlist?.name === document.netlist?.name,
    )!;
    const objects = (cell.drafting?.objects ?? []).filter(
      (object) => object.kind !== "text",
    );
    expect(objects).toEqual([
      expect.objectContaining({
        kind: "rectangle",
        center: { x: 500, y: -150 },
        width: 160,
        height: 80,
        rotation: 0,
        lineStyle: "dashed",
        layer: "background",
        styleOverride: { fillColor: "#eef4ff" },
      }),
      expect.objectContaining({
        kind: "rectangle",
        center: { x: 860, y: -150 },
        width: 80,
        height: 40,
        rotation: 30,
      }),
      expect.objectContaining({
        kind: "circle",
        center: { x: 1000, y: -150 },
        radius: 30,
        lineStyle: "dotted",
        styleOverride: { color: "#cc0000" },
      }),
      expect.objectContaining({
        kind: "construction-line",
        points: [
          { x: 400, y: -300 },
          { x: 500, y: -300 },
          { x: 600, y: -250 },
        ],
        curveControls: [null, { x: 580, y: -310 }],
        lineStyle: "dashed",
      }),
      expect.objectContaining({
        kind: "arrow",
        from: free(400, -400),
        to: free(560, -400),
        styleOverride: { arrowEnd: "medium-arrow" },
      }),
    ]);
  });

  it("draws a port drawn several times with as many Cell Pins", async () => {
    const project = parseProject(
      readFileSync(
        resolve(
          import.meta.dirname,
          "../../../../../fixtures/projects/port-nets/project.icproj.json",
        ),
        "utf8",
      ),
    );
    const { project: drawn, diagnostics } = await roundTrip(project);
    const pins = (from: CircuitProject) =>
      from.documents
        .flatMap((document) =>
          (document.netlist?.terminals ?? []).map(
            (terminal) =>
              `${terminal.name} ${terminal.interfaceInstanceIds.length}`,
          ),
        )
        .sort();
    expect(pins(drawn)).toEqual(pins(project));
    expect(diagnostics.filter((item) => item.code.startsWith("RNL_"))).toEqual(
      [],
    );
  });

  it("lays out a Cell's block as the RNL draws it", async () => {
    const project = example("simulation-ota");
    const { project: drawn } = await roundTrip(project);
    const slots = (from: CircuitProject) => {
      const cell = from.documents.find(
        (document) => document.netlist?.name === "ota_5t",
      )!;
      const names = new Map(
        cell.netlist!.terminals.map((terminal) => [terminal.id, terminal.name]),
      );
      return cellSymbolPinSlots(from, cell)
        .map(
          (slot) => `${names.get(slot.terminalId)} ${slot.side} ${slot.offset}`,
        )
        .sort();
    };
    expect(slots(drawn)).toEqual(slots(project));
  });

  it("reads back wire arrows, a current marker and a floating symbol", async () => {
    const project = example("simulation-rc");
    const document = project.documents.find(
      (item) => item.id === project.topDocumentId,
    )!;
    document.drafting = {
      objects: [
        {
          id: "figure",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 1100, y: -300 } },
          kind: "floating-symbol",
          symbolId: "resistor",
          transform: { rotation: 90, mirror: "none" },
        },
      ],
    };
    const [first, second] = document.routes;
    first!.styleOverride = { arrow: "middle" };
    second!.styleOverride = { arrow: "end" };
    document.annotations.push({
      id: "current",
      kind: "route-marker",
      content: {
        runs: [
          { kind: "text", value: "I" },
          {
            kind: "span",
            style: "subscript",
            children: [{ kind: "text", value: "D" }],
          },
        ],
      },
      anchor: {
        kind: "route",
        routeId: first!.id,
        legId: first!.legs[0]!.id,
        t: 0.5,
        normalOffset: -14,
        direction: "forward",
        orientation: "follow",
        fallbackPosition: { x: 0, y: 0 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
      markerKind: "current",
    });
    document.annotations.push({
      id: "voltage",
      kind: "route-marker",
      content: { runs: [{ kind: "text", value: "Vin" }] },
      anchor: {
        kind: "route",
        routeId: second!.id,
        legId: second!.legs[0]!.id,
        t: 0.5,
        normalOffset: 0,
        direction: "forward",
        orientation: "follow",
        fallbackPosition: { x: 0, y: 0 },
      },
      alignment: "start",
      rotation: 0,
      locked: false,
      markerKind: "voltage",
    });
    const { project: drawn } = await roundTrip(project);
    const cell = drawn.documents.find(
      (item) => item.netlist?.name === document.netlist?.name,
    )!;
    expect(
      cell.annotations.find((item) => item.markerKind === "voltage"),
    ).toMatchObject({
      kind: "route-marker",
      content: { runs: [{ kind: "text", value: "Vin" }] },
      alignment: "start",
      anchor: { t: 0.5, direction: "forward", orientation: "follow" },
    });
    expect(
      cell.routes.map((route) => route.styleOverride?.arrow).filter(Boolean),
    ).toEqual(["middle", "end"]);
    const marker = cell.annotations.find(
      (item) => item.kind === "route-marker",
    );
    expect(marker).toMatchObject({
      markerKind: "current",
      anchor: {
        t: 0.5,
        normalOffset: -14,
        direction: "forward",
        orientation: "follow",
      },
    });
    expect(marker?.content).toEqual({
      runs: [
        { kind: "text", value: "I" },
        {
          kind: "span",
          style: "subscript",
          children: [{ kind: "text", value: "D" }],
        },
      ],
    });
    expect(
      cell.drafting?.objects.filter(
        (object) => object.kind === "floating-symbol",
      ),
    ).toEqual([
      expect.objectContaining({
        kind: "floating-symbol",
        symbolId: "resistor",
        anchor: { kind: "free", position: { x: 1100, y: -300 } },
        transform: { rotation: 90, mirror: "none" },
      }),
    ]);
  });
});

/**
 * A comparator placed in Cell `dut`, bound as a placed one is, each signal
 * pin on a Cell Pin and, when `powered`, its VDD too.
 */
function comparator(
  parameters: Record<string, string>,
  powered: boolean,
): CircuitProject {
  const project = createEmptyProject("comparator", "Comparator", "dut");
  const document = project.documents[0]!;
  document.netlist!.name = "dut";
  document.instances.push({
    id: "block",
    symbolId: "comparator",
    reference: "X1",
    placement: { position: { x: 100, y: 0 }, rotation: 0, mirror: "none" },
    netlist: {
      binding: { kind: "unresolved-subcircuit", name: IDEAL_COMPARATOR_TARGET },
      parameters,
    },
  });
  for (const port of subcircuitDescriptor("comparator")!.ports) {
    const pinName = port.pinName ?? port.supply;
    if (port.supply && !(powered && port.supply === "VDD")) continue;
    const id = `pin-${port.name}`;
    document.instances.push({ id, symbolId: "port", placement: null });
    document.nets.push({
      id: port.name,
      terminals: [
        { instanceId: id, pinName: "P" },
        { instanceId: "block", pinName },
      ],
    });
    document.netlist!.terminals.push({
      id: `terminal-${port.name}`,
      name: port.name,
      netId: port.name,
      direction: "inout",
      interfaceInstanceIds: [id],
    });
  }
  return project;
}

describe("RNL round trip of built-in blocks", () => {
  it.each([
    ["icm_ideal_comparator", { vhigh: "1" }, false],
    ["icm_ideal_comparator_vdd", {}, true],
  ] as const)(
    "draws a comparator calling %s and brings it back",
    async (body, parameters, powered) => {
      for (const format of ["spice", "spectre"] as const) {
        const project = comparator(parameters, powered);
        const plan = await roundTrip(project, format);
        expect(
          plan.diagnostics.filter((item) => item.severity === "error"),
        ).toEqual([]);
        const part = plan.project.documents
          .flatMap((document) => document.instances)
          .find((instance) => instance.reference === "X1")!;
        expect(rnlPart(part)).toEqual(
          rnlPart(project.documents[0]!.instances[0]!),
        );
        const again = createDesignNetlistExport(plan.project, { format });
        expect(again.status === "ready" && again.file.text).toMatch(
          new RegExp(`^X1 .* ${body}( |$)`, "mu"),
        );
      }
    },
  );
});
