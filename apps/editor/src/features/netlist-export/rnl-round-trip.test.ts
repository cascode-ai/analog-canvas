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
  externalSubcircuitSymbolId,
} from "@icm/symbols";
import { startCore } from "@rich-netlist/runtime";

import { labelCensus, labelDifferences } from "../../../e2e/label-census";
import { withImportedInstanceDisplays } from "../instance-display/imported-instance-displays";
import { materializeRazaviProjectBulkConnections } from "../../presentation/razavi-presentation";
import { createDefaultNetlistExportPreferences } from "./netlist-export-preferences";
import { prepareNetlistExample } from "./netlist-process";
import { planRnlImport } from "./rnl-import";
import type { RnlRuntime } from "./rnl-runtime";

/** An arrow end's style, as a drawing object keeps it. */
type ArrowEnd =
  | "small-arrow"
  | "medium-arrow"
  | "large-arrow"
  | "dot"
  | "none"
  | "open-arrow";

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
  return importRnl(written.text, format);
}

const pathOf = (format: "spice" | "spectre") =>
  format === "spice" ? "circuit.sp" : "circuit.scs";

/** Import a rich netlist as File > Import > RNL... does. */
async function importRnl(text: string, format: "spice" | "spectre") {
  const path = pathOf(format);
  const plan = await planRnlImport({
    inputs: [{ path, bytes: new TextEncoder().encode(text) }],
    entryPath: path,
    runtime,
  });
  if (plan.status !== "ready") throw new Error(plan.message);
  return plan;
}

/** Diagnostics that say the drawing did not come back as written. */
const failures = (plan: Awaited<ReturnType<typeof importRnl>>) =>
  plan.diagnostics.filter(
    (item) => item.severity === "error" || item.code === "RNL_IMPORT_RNL_ERROR",
  );

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

  it.each([
    "simulation-rc",
    "simulation-ota",
    "simulation-common-source",
    "two-stage-op-amp",
  ])(
    "shows %s's names and net labels where it showed them, and no others",
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
                annotation.visible !== false &&
                (annotation.kind === "net-label" ||
                  (annotation.kind === "instance-label" &&
                    annotation.binding?.kind === "instance-reference")),
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
      expect(shown(drawn, (id) => id).sort()).toEqual(original.sort());
    },
  );

  it("keeps a name the drawing does not show hidden, in its usual place", async () => {
    const { project: drawn } = await roundTrip(example("two-stage-op-amp"));
    const names = drawn.documents
      .flatMap((document) => document.annotations)
      .flatMap((annotation) =>
        annotation.kind === "instance-label" &&
        annotation.binding?.kind === "instance-reference" &&
        ["X1", "X2"].includes(annotation.binding.instanceId)
          ? [
              {
                part: annotation.binding.instanceId,
                visible: annotation.visible,
                placed: annotation.anchor.kind === "object",
              },
            ]
          : [],
      );
    expect(names.sort((a, b) => a.part.localeCompare(b.part))).toEqual([
      { part: "X1", visible: false, placed: true },
      { part: "X2", visible: false, placed: true },
    ]);
  });

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
        styleOverride: { arrowStart: "none", arrowEnd: "medium-arrow" },
      }),
    ]);
  });

  it("reads back leaders, callouts, polarity marks and arrows as Analog Canvas drew them", async () => {
    const project = example("simulation-rc");
    const document = project.documents.find(
      (item) => item.id === project.topDocumentId,
    )!;
    const free = (x: number, y: number) =>
      ({ kind: "free", position: { x, y } }) as const;
    const base = (id: string, zIndex: number, x: number, y: number) => ({
      id,
      locked: false,
      zIndex,
      anchor: free(x, y),
    });
    const words = (value: string) => ({
      runs: [{ kind: "text" as const, value }],
    });
    const bare = { runs: [{ kind: "line-break" as const }] };
    const arrow = (
      id: string,
      zIndex: number,
      [x1, y1, x2, y2]: [number, number, number, number],
      arrowStart: ArrowEnd,
      arrowEnd: ArrowEnd,
      width?: number,
    ) => ({
      ...base(id, zIndex, x1, y1),
      kind: "arrow" as const,
      from: free(x1, y1),
      to: free(x2, y2),
      ...(width ? { outline: { width } } : {}),
      styleOverride: { arrowStart, arrowEnd },
    });
    document.drafting = {
      objects: [
        {
          ...base("lead", 0, 400, -500),
          kind: "leader",
          target: free(500, -560),
          styleOverride: { lineStyle: "dashed", color: "#cc0000" },
        },
        {
          ...base("call", 1, 600, -500),
          kind: "callout",
          content: words("bias"),
          alignment: "start",
          rotation: 0,
          target: free(700, -560),
        },
        {
          ...base("both", 2, 800, -500),
          kind: "text",
          content: words("Vx"),
          alignment: "middle",
          rotation: 0,
          polarity: "both",
        },
        {
          ...base("plus", 3, 900, -500),
          kind: "text",
          content: bare,
          alignment: "middle",
          rotation: 0,
          polarity: "positive",
        },
        {
          ...base("minus", 4, 950, -500),
          kind: "text",
          content: bare,
          alignment: "middle",
          rotation: 0,
          polarity: "negative",
        },
        arrow("open", 5, [400, -650, 560, -650], "none", "open-arrow"),
        arrow("dot", 6, [600, -650, 760, -650], "dot", "small-arrow"),
        arrow("big", 7, [800, -650, 960, -650], "large-arrow", "large-arrow"),
        arrow("fat", 8, [400, -800, 600, -800], "none", "medium-arrow", 30),
        arrow(
          "fat2",
          9,
          [650, -800, 850, -800],
          "medium-arrow",
          "medium-arrow",
          30,
        ),
        arrow("bar", 10, [900, -800, 1000, -800], "none", "none", 30),
      ],
    };
    const { project: drawn, diagnostics } = await roundTrip(project);
    const cell = drawn.documents.find(
      (item) => item.netlist?.name === document.netlist?.name,
    )!;
    // The example's own drawing text comes back too; these all have marks.
    const objects = (cell.drafting?.objects ?? []).filter(
      (object) => object.kind !== "text" || object.polarity,
    );
    expect(
      diagnostics.filter((item) => item.code === "RNL_IMPORT_DRAWING_UNJOINED"),
    ).toEqual([]);
    // Each comes back as one object of its own kind, in its stacking order.
    expect(objects.map((object) => object.kind)).toEqual(
      document.drafting.objects.map((object) => object.kind),
    );
    const [lead, call, both, plus, minus, open, dot, big, fat, fat2, bar] =
      objects;
    expect(lead).toMatchObject({
      anchor: free(400, -500),
      target: free(500, -560),
      styleOverride: { lineStyle: "dashed", color: "#cc0000" },
    });
    expect(call).toMatchObject({
      anchor: free(600, -500),
      target: free(700, -560),
      content: words("bias"),
      alignment: "start",
    });
    expect(both).toMatchObject({ content: words("Vx"), polarity: "both" });
    expect(plus).toMatchObject({
      anchor: free(900, -500),
      content: bare,
      polarity: "positive",
    });
    expect(minus).toMatchObject({
      anchor: free(950, -500),
      polarity: "negative",
    });
    expect(open).toMatchObject({
      from: free(400, -650),
      to: free(560, -650),
      styleOverride: { arrowStart: "none", arrowEnd: "open-arrow" },
    });
    expect(dot).toMatchObject({
      from: free(600, -650),
      to: free(760, -650),
      styleOverride: { arrowStart: "dot", arrowEnd: "small-arrow" },
    });
    expect(big).toMatchObject({
      styleOverride: { arrowStart: "large-arrow", arrowEnd: "large-arrow" },
    });
    for (const [back, from, to, start, end] of [
      [fat, 400, 600, "none", "medium-arrow"],
      [fat2, 650, 850, "medium-arrow", "medium-arrow"],
      [bar, 900, 1000, "none", "none"],
    ] as const)
      expect(back).toMatchObject({
        from: free(from, -800),
        to: free(to, -800),
        outline: { width: 30 },
        styleOverride: { arrowStart: start, arrowEnd: end },
      });
  });

  it("reads back ellipses as circles or curves, and arcs as curves", async () => {
    // Analog Canvas writes neither; another tool's file may hold both.
    const exported = createRnlExport(example("simulation-rc"), {
      format: "spice",
    });
    if (exported.status !== "ready") throw new Error("export blocked");
    const level = exported.request.ops.find((op) => op.op === "set")!.level;
    const request = {
      ...exported.request,
      ops: [
        ...exported.request.ops,
        ...[
          {
            shape: "ellipse",
            points: [[100, -15]],
            params: { width: 6, height: 6 },
          },
          {
            shape: "ellipse",
            points: [[110, -15]],
            params: { width: 8, height: 4, fill: "linecolor" },
          },
          {
            shape: "arc",
            points: [
              [120, -10],
              [122, -12],
              [124, -10],
            ],
            params: { arrow: "end" },
          },
          {
            shape: "arc",
            points: [
              [130, -10],
              [132, -8],
              [134, -10],
            ],
          },
        ].map((shape) => ({ level, op: "add-shape", ...shape })),
      ],
    } as unknown as typeof exported.request;
    const written = await runtime.write({ write: request, svg: false });
    const plan = await planRnlImport({
      inputs: [
        { path: "circuit.sp", bytes: new TextEncoder().encode(written.text) },
      ],
      entryPath: "circuit.sp",
      runtime,
    });
    if (plan.status !== "ready") throw new Error(plan.message);
    const objects = plan.project.documents.flatMap(
      (document) => document.drafting?.objects ?? [],
    );
    expect(objects.find((object) => object.kind === "circle")).toMatchObject({
      center: { x: 1000, y: 150 },
      radius: 30,
    });
    // An eighth of a turn a leg, each quadratic within 0.3 % of the curve.
    const oval = objects.find(
      (object) =>
        object.kind === "construction-line" && object.points.length === 9,
    );
    expect(oval).toMatchObject({
      points: [
        { x: 1140, y: 150 },
        { x: 1128, y: 164 },
        { x: 1100, y: 170 },
        { x: 1072, y: 164 },
        { x: 1060, y: 150 },
        { x: 1072, y: 136 },
        { x: 1100, y: 130 },
        { x: 1128, y: 136 },
        { x: 1140, y: 150 },
      ],
    });
    expect(
      oval?.kind === "construction-line" && oval.curveControls?.every(Boolean),
    ).toBe(true);
    expect(objects.find((object) => object.kind === "arrow")).toMatchObject({
      from: { kind: "free", position: { x: 1200, y: 100 } },
      to: { kind: "free", position: { x: 1240, y: 100 } },
      waypoints: [
        { x: 1206, y: 114 },
        { x: 1220, y: 120 },
        { x: 1234, y: 114 },
      ],
      styleOverride: { arrowEnd: "medium-arrow" },
    });
    expect(
      objects.find(
        (object) =>
          object.kind === "construction-line" && object.points.length === 5,
      ),
    ).toMatchObject({
      points: [
        { x: 1300, y: 100 },
        { x: 1306, y: 86 },
        { x: 1320, y: 80 },
        { x: 1334, y: 86 },
        { x: 1340, y: 100 },
      ],
    });
    expect(
      plan.diagnostics.filter((item) =>
        item.code.startsWith("RNL_IMPORT_SHAPE"),
      ),
    ).toEqual([expect.objectContaining({ code: "RNL_IMPORT_SHAPE_UNFILLED" })]);
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
  symbolId: string,
  parameters: Record<string, string>,
  powered: boolean,
): CircuitProject {
  const project = createEmptyProject("comparator", "Comparator", "dut");
  const document = project.documents[0]!;
  document.netlist!.name = "dut";
  document.instances.push({
    id: "block",
    symbolId,
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
  it.each(
    (["comparator", "comparator-unmarked"] as const).flatMap((symbolId) =>
      (
        [
          ["icm_ideal_comparator", { vhigh: "1" }, false],
          ["icm_ideal_comparator_vdd", {}, true],
        ] as const
      ).map(
        ([body, parameters, powered]) =>
          [symbolId, body, parameters, powered] as const,
      ),
    ),
  )(
    "draws a %s calling %s and brings it back",
    async (symbolId, body, parameters, powered) => {
      for (const format of ["spice", "spectre"] as const) {
        const project = comparator(symbolId, parameters, powered);
        const plan = await roundTrip(project, format);
        // RNL's own errors, such as a pin on a terminal the call lacks,
        // come in as warnings.
        expect(
          plan.diagnostics.filter(
            (item) =>
              item.severity === "error" || item.code === "RNL_IMPORT_RNL_ERROR",
          ),
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

/**
 * Switches placed in Cell `dut` with a ground: S1 clocked by the phase its
 * label names, S2 by its own name, S3 by its CTRL pin, and a chopper
 * clocked by its label.
 */
function switches(): CircuitProject {
  const project = createEmptyProject("switches", "Switches", "main");
  const document = project.documents[0]!;
  document.netlist!.name = "dut";
  const at = (x: number, y: number) =>
    ({ position: { x, y }, rotation: 0, mirror: "none" }) as const;
  const port = (id: string, name: string, net: string, x: number) => {
    document.instances.push({ id, symbolId: "port", placement: at(x, 0) });
    document.netlist!.terminals.push({
      id: `terminal-${id}`,
      name,
      netId: net,
      direction: "inout",
      interfaceInstanceIds: [id],
    });
    return { instanceId: id, pinName: "P" };
  };
  document.instances.push(
    { id: "GND1", symbolId: "ground", placement: at(600, 300) },
    {
      id: "C1",
      symbolId: "capacitor",
      reference: "C1",
      placement: at(600, 200),
      netlist: {
        binding: { kind: "primitive", deviceClass: "capacitor" },
        // As the conversion from Spectre spells it, so both dialects compare.
        parameters: { value: "1e-12" },
      },
    },
    {
      id: "S1",
      symbolId: "simple-switch",
      reference: "S1",
      placement: at(100, 100),
    },
    {
      id: "S2",
      symbolId: "ideal-switch",
      reference: "S2",
      placement: at(200, 100),
    },
    {
      id: "S3",
      symbolId: "externally-controlled-switch",
      reference: "S3",
      placement: at(300, 100),
    },
    {
      id: "CH1",
      symbolId: "chopper",
      reference: "CH1",
      placement: at(450, 100),
    },
  );
  document.nets.push(
    {
      id: "a",
      terminals: [
        port("PA", "A", "a", 0),
        { instanceId: "S1", pinName: "1" },
        { instanceId: "S2", pinName: "1" },
        { instanceId: "S3", pinName: "P" },
        { instanceId: "CH1", pinName: "INP" },
      ],
    },
    {
      id: "b",
      terminals: [
        port("PB", "B", "b", 50),
        { instanceId: "S1", pinName: "2" },
        { instanceId: "S2", pinName: "2" },
        { instanceId: "S3", pinName: "N" },
        { instanceId: "CH1", pinName: "INN" },
        { instanceId: "C1", pinName: "1" },
      ],
    },
    {
      id: "c",
      terminals: [
        port("PC", "C", "c", 700),
        { instanceId: "S3", pinName: "CTRL" },
        { instanceId: "CH1", pinName: "OUTP" },
      ],
    },
    {
      id: "d",
      terminals: [
        port("PD", "D", "d", 750),
        { instanceId: "CH1", pinName: "OUTN" },
      ],
    },
    {
      id: "gnd",
      terminals: [
        { instanceId: "GND1", pinName: "0" },
        { instanceId: "C1", pinName: "2" },
      ],
    },
  );
  document.connectivityEvidence.push({
    id: "gnd-claim",
    kind: "name-claim",
    netId: "gnd",
    name: "0",
    scope: "global",
    powerDomain: "ground",
    owner: { kind: "power-marker", objectId: "GND1" },
  });
  for (const [id, text] of [
    ["S1", "Φ1"],
    ["CH1", "Φ2"],
  ] as const)
    document.annotations.push({
      id: `label-${id}`,
      kind: "instance-label",
      content: { runs: [{ kind: "text", value: text }] },
      anchor: {
        kind: "object",
        objectId: id,
        localOffset: { x: 0, y: -30 },
        fallbackPosition: { x: 0, y: 0 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });
  return project;
}

describe("RNL round trip of switches", () => {
  it.each(["spice", "spectre"] as const)(
    "brings each switch back clocked as it was drawn (%s)",
    async (format) => {
      const project = switches();
      const plan = await roundTrip(project, format);
      expect(
        plan.diagnostics.filter(
          (item) =>
            item.severity === "error" || item.code === "RNL_IMPORT_RNL_ERROR",
        ),
      ).toEqual([]);
      const parts = plan.project.documents.flatMap(
        (document) => document.instances,
      );
      for (const reference of ["S1", "S2", "S3", "CH1"]) {
        const original = project.documents[0]!.instances.find(
          (instance) => instance.reference === reference,
        )!;
        const part = parts.find((instance) => instance.reference === reference);
        expect(part && rnlPart(part)).toEqual(rnlPart(original));
        expect(part?.symbolId).toBe(original.symbolId);
      }
      // Each part its label clocks names its phase in its label again.
      const phases = plan.project.documents.flatMap((document) =>
        document.annotations.flatMap((annotation) =>
          annotation.kind === "instance-label" &&
          !annotation.binding &&
          annotation.content &&
          annotation.anchor.kind === "object"
            ? [
                `${parts.find((part) => part.id === (annotation.anchor as { objectId: string }).objectId)?.reference} ${flattenRichText(annotation.content)}`,
              ]
            : [],
        ),
      );
      expect(phases.sort()).toEqual(["CH1 Φ2", "S1 Φ1"]);
      for (const spice of [false, true]) {
        const options = { format: spice ? "spice" : format } as const;
        const before = createDesignNetlistExport(project, options);
        const after = createDesignNetlistExport(plan.project, options);
        expect(after.status === "ready" && after.file.text).toBe(
          before.status === "ready" && before.file.text,
        );
      }
    },
  );
});

const GATES_4 = ["and", "nand", "or", "nor", "xor", "xnor"] as const;

/**
 * The six 4-input gates in Cell `dut`, one above another, each pin wired
 * straight across to a Cell Pin level with it.
 */
function gates4(): CircuitProject {
  const project = createEmptyProject("gates", "Gates", "dut");
  const document = project.documents[0]!;
  document.netlist!.name = "dut";
  const symbols = new Map(builtInSymbols.map((symbol) => [symbol.id, symbol]));
  const portPin = symbols.get("port")!.pins[0]!.at;
  const at = (x: number, y: number) =>
    ({ position: { x, y }, rotation: 0, mirror: "none" }) as const;
  GATES_4.forEach((gate, row) => {
    const symbolId = `${gate}-gate-4`;
    const reference = `X${row + 1}`;
    const position = { x: 200, y: 100 + row * 100 };
    document.instances.push({
      id: reference,
      symbolId,
      reference,
      placement: at(position.x, position.y),
      netlist: {
        binding: {
          kind: "unresolved-subcircuit",
          name: subcircuitDescriptor(symbolId)!.target,
        },
        parameters: {},
      },
    });
    for (const pin of symbols.get(symbolId)!.pins) {
      const node = `n_${reference}_${pin.name}`.toLowerCase();
      const port = `pin-${node}`;
      const x = position.x + pin.at.x + (pin.at.x < 0 ? -60 : 60);
      const y = position.y + pin.at.y;
      document.instances.push({
        id: port,
        symbolId: "port",
        placement: at(x - portPin.x, y - portPin.y),
      });
      document.nets.push({
        id: node,
        terminals: [
          { instanceId: port, pinName: "P" },
          { instanceId: reference, pinName: pin.name },
        ],
      });
      document.netlist!.terminals.push({
        id: `terminal-${node}`,
        name: node,
        netId: node,
        direction: "inout",
        interfaceInstanceIds: [port],
      });
      document.routes.push({
        id: `route-${node}`,
        netId: node,
        start: { kind: "terminal", instanceId: port, pinName: "P" },
        legs: [
          {
            id: `leg-${node}`,
            to: {
              kind: "endpoint",
              endpoint: {
                kind: "terminal",
                instanceId: reference,
                pinName: pin.name,
              },
            },
            mode: "manual",
          },
        ],
      });
    }
  });
  return project;
}

describe("RNL round trip of 4-input gates", () => {
  it.each(["spice", "spectre"] as const)(
    "draws Analog Canvas's own gates, every wire level, and brings them back (%s)",
    async (format) => {
      const project = gates4();
      const exported = createRnlExport(project, { format });
      if (exported.status !== "ready") throw new Error("export blocked");
      const written = await runtime.write({
        write: exported.request,
        svg: false,
      });
      for (const gate of GATES_4)
        expect(written.text).toContain(
          `@SET-SYMBOL $CANVAS_${gate.toUpperCase()}_4INPUT`,
        );
      expect(written.text).toContain(
        '@USE-PACKAGE(name="analog-canvas-extensions", version="0.1")',
      );
      // RNL's standard gates have their inputs elsewhere; Analog Canvas's
      // own keep each wire level, in RNL as in the editor.
      const path = pathOf(format);
      const snapshot = await runtime.snapshot({
        entry: path,
        files: { [path]: written.text },
        dialect: format,
        parts: { drawing: false, host: true, model: true },
      });
      expect(
        snapshot.diagnostics.filter((item) => item.severity === "error"),
      ).toEqual([]);
      const wires = snapshot.levels.flatMap(
        (level) => level.model?.wires ?? [],
      );
      expect(wires).toHaveLength(30);
      expect(
        wires.filter(
          (wire) => new Set(wire.points.map((point) => point?.[1])).size !== 1,
        ),
      ).toEqual([]);

      const plan = await importRnl(written.text, format);
      expect(failures(plan)).toEqual([]);
      const parts = plan.project.documents.flatMap(
        (document) => document.instances,
      );
      for (const original of project.documents[0]!.instances) {
        if (!original.reference) continue;
        const part = parts.find(
          (instance) => instance.reference === original.reference,
        );
        expect(part?.symbolId).toBe(original.symbolId);
        expect(part && rnlPart(part)).toEqual(rnlPart(original));
      }
      expect(
        plan.project.documents.flatMap((document) => document.routes),
      ).toHaveLength(30);
      const before = createDesignNetlistExport(project, { format });
      const after = createDesignNetlistExport(plan.project, { format });
      expect(after.status === "ready" && after.file.text).toBe(
        before.status === "ready" && before.file.text,
      );
    },
  );

  it.each(["spice", "spectre"] as const)(
    "reads RNL's standard 4-input gates back as Analog Canvas's own (%s)",
    async (format) => {
      const project = gates4();
      const exported = createRnlExport(project, { format });
      if (exported.status !== "ready") throw new Error("export blocked");
      // The same drawing as another tool writes it, with RNL's own gates.
      const request = JSON.parse(
        JSON.stringify(exported.request)
          .replaceAll("$CANVAS_", "$")
          .replace(
            '"name":"analog-canvas-extensions","version":"0.1"',
            '"name":"rnl-std-logic","version":"0.3"',
          ),
      ) as typeof exported.request;
      const written = await runtime.write({ write: request, svg: false });
      expect(written.text).not.toContain("$CANVAS_");
      expect(written.text).toContain("@SET-SYMBOL $AND_4INPUT");
      const plan = await importRnl(written.text, format);
      expect(failures(plan)).toEqual([]);
      const parts = plan.project.documents.flatMap(
        (document) => document.instances,
      );
      for (const original of project.documents[0]!.instances) {
        if (!original.reference) continue;
        const part = parts.find(
          (instance) => instance.reference === original.reference,
        );
        expect(part?.symbolId).toBe(original.symbolId);
        expect(part?.placement).toEqual(original.placement);
      }
      const before = createDesignNetlistExport(project, { format });
      const after = createDesignNetlistExport(plan.project, { format });
      expect(after.status === "ready" && after.file.text).toBe(
        before.status === "ready" && before.file.text,
      );
    },
  );
});

/**
 * Two calls of a subcircuit a Spectre model source defines in a SPICE
 * section, placed in the top Cell, their pins left unconnected.
 */
function spiceModelSource(): CircuitProject {
  const project = createEmptyProject("owned-model", "Owned model");
  project.modelSources = [
    {
      id: "source",
      language: "spectre",
      revision: 1,
      entry: "gain.scs",
      dependencies: [],
      files: [
        {
          path: "gain.scs",
          text: "simulator lang=spice\n.subckt gain_block A B params: gain=2\nRLOAD A B {gain*1k}\n.ends gain_block\nsimulator lang=spectre\n",
        },
      ],
    },
  ];
  project.externalSubcircuitDefinitions = [
    {
      id: "gain",
      name: "gain_block",
      interfaceStatus: "declared",
      terminals: [
        { id: "a", name: "A", direction: "input" },
        { id: "b", name: "B", direction: "output" },
      ],
      formalParameters: [{ name: "gain", defaultValue: "2" }],
      implementation: {
        kind: "source",
        sourceId: "source",
        entry: "gain_block",
      },
    },
  ];
  const document = project.documents[0]!;
  for (const id of ["X1", "X2"]) {
    document.instances.push({
      id,
      reference: id,
      symbolId: externalSubcircuitSymbolId("gain"),
      placement: {
        position: { x: 200, y: id === "X1" ? 160 : 280 },
        rotation: 0,
        mirror: "none",
      },
      netlist: {
        binding: { kind: "external-subcircuit", definitionId: "gain" },
        parameters: {},
      },
    });
    for (const pinName of ["A", "B"])
      document.noConnects.push({
        id: id + pinName,
        endpoint: { kind: "terminal", instanceId: id, pinName },
      });
  }
  return project;
}

describe("RNL round trip of a Spectre netlist with a SPICE section", () => {
  it("writes no record inside the SPICE section, and reads the calls back", async () => {
    const project = spiceModelSource();
    const exported = createRnlExport(project, { format: "spectre" });
    if (exported.status !== "ready")
      throw new Error(
        `export blocked: ${JSON.stringify([...exported.netlistDiagnostics, ...exported.diagnostics].filter((item) => item.severity === "error"))}`,
      );
    const written = await runtime.write({
      write: exported.request,
      svg: false,
    });
    const lines = written.text.split(/\r?\n/u);
    const start = lines.indexOf("simulator lang=spice");
    const end = lines.indexOf("simulator lang=spectre", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(
      lines
        .slice(start, end)
        .filter((line) => /^(\*|\/\/).*@[A-Z]/u.test(line)),
    ).toEqual([]);
    const plan = await importRnl(written.text, "spectre");
    expect(failures(plan)).toEqual([]);
    const parts = plan.project.documents.flatMap(
      (document) => document.instances,
    );
    // The import makes its own external definition; each call stands where
    // it was drawn.
    for (const original of project.documents[0]!.instances) {
      const part = parts.find((instance) => instance.reference === original.id);
      expect(part?.placement, original.id).toEqual(original.placement);
    }
  });
});

/** A primitive's device class, as an instance binds it. */
type PrimitiveClass = Extract<
  NonNullable<NonNullable<Instance["netlist"]>["binding"]>,
  { kind: "primitive" }
>["deviceClass"];

const CONTROLLED_SOURCE_KINDS = ["vcvs", "vccs", "ccvs", "cccs"];

/**
 * The four controlled sources in either appearance, each into its own load: the
 * voltage-controlled ones sense V1's voltage, the current-controlled ones
 * its current.
 */
function controlledSources(
  kinds: readonly string[] = CONTROLLED_SOURCE_KINDS,
  shape: "circle" | "diamond" = "diamond",
): CircuitProject {
  const project = createEmptyProject(
    "controlled-sources",
    "Controlled Sources",
  );
  const document = project.documents[0]!;
  const at = (x: number, y: number) =>
    ({ position: { x, y }, rotation: 0, mirror: "none" }) as const;
  const part = (
    id: string,
    symbolId: string,
    deviceClass: PrimitiveClass,
    x: number,
    parameters: Record<string, string>,
    more: Partial<Instance> = {},
  ): Instance => ({
    id,
    symbolId,
    reference: id,
    placement: at(x, 100),
    netlist: { binding: { kind: "primitive", deviceClass }, parameters },
    ...more,
  });
  const appearance = shape === "diamond" ? { symbolVariantId: "diamond" } : {};
  // Values as the conversion from Spectre spells them, so both dialects
  // compare.
  const sources = [
    [
      "E1",
      "vcvs",
      { gain: "2" },
      { kind: "voltage", positiveNetId: "a", negativeNetId: "gnd" },
    ],
    [
      "G1",
      "vccs",
      { gm: "0.001" },
      { kind: "voltage", positiveNetId: "a", negativeNetId: "gnd" },
    ],
    ["H1", "ccvs", { rm: "1000" }, { kind: "current", sensorInstanceId: "V1" }],
    ["F1", "cccs", { gain: "2" }, { kind: "current", sensorInstanceId: "V1" }],
  ] as const;
  document.instances.push(
    { id: "GND1", symbolId: "ground", placement: at(100, 300) },
    part("V1", "voltage-source", "voltage-source", 100, { dc: "1" }),
    part("R1", "resistor", "resistor", 200, { value: "1000" }),
  );
  const gnd = [
    { instanceId: "GND1", pinName: "0" },
    { instanceId: "V1", pinName: "-" },
    { instanceId: "R1", pinName: "2" },
  ];
  document.nets.push({
    id: "a",
    terminals: [
      { instanceId: "V1", pinName: "+" },
      { instanceId: "R1", pinName: "1" },
    ],
  });
  sources
    .filter(([, kind]) => kinds.includes(kind))
    .forEach(([id, kind, parameters, control], index) => {
      const x = 300 + index * 200;
      const load = `R${id}`;
      const source = part(id, kind, kind, x, parameters, appearance);
      source.netlist!.control = control;
      document.instances.push(
        source,
        part(load, "resistor", "resistor", x + 100, { value: "1000" }),
      );
      document.nets.push({
        id: id.toLowerCase(),
        terminals: [
          { instanceId: id, pinName: "+" },
          { instanceId: load, pinName: "1" },
        ],
      });
      gnd.push(
        { instanceId: id, pinName: "-" },
        { instanceId: load, pinName: "2" },
      );
    });
  document.nets.push({ id: "gnd", terminals: gnd });
  document.connectivityEvidence.push({
    id: "gnd-claim",
    kind: "name-claim",
    netId: "gnd",
    name: "0",
    scope: "global",
    powerDomain: "ground",
    owner: { kind: "power-marker", objectId: "GND1" },
  });
  return project;
}

describe.each(["circle", "diamond"] as const)(
  "RNL round trip of controlled sources drawn as %s",
  (shape) => {
    // Analog Canvas's Spectre import reads no native ccvs or cccs, so Spectre
    // brings back the voltage-controlled ones.
    it.each([
      ["spice", CONTROLLED_SOURCE_KINDS],
      ["spectre", ["vcvs", "vccs"]],
    ] as const)(
      "preserves each source appearance through its canonical symbol (%s)",
      async (format, kinds) => {
        const project = withImportedInstanceDisplays(
          controlledSources(kinds, shape),
        );
        const exported = createRnlExport(project, { format });
        if (exported.status !== "ready") throw new Error("export blocked");
        const written = await runtime.write({
          write: exported.request,
          svg: false,
        });
        for (const kind of kinds) {
          const symbol =
            shape === "diamond"
              ? `$${kind.toUpperCase()}`
              : `$CANVAS_${kind.toUpperCase()}_CIRCLE`;
          expect(written.text).toContain(`@SET-SYMBOL ${symbol}`);
        }
        expect(written.text.includes("$CANVAS_")).toBe(shape === "circle");
        expect(
          exported.diagnostics.some(
            (item) => item.code === "RNL_NOT_STANDARD_SYMBOL",
          ),
        ).toBe(shape === "circle");
        const plan = await importRnl(written.text, format);
        expect(failures(plan)).toEqual([]);
        expect(
          labelCensus(project).filter((label) => !label.hidden).length,
        ).toBeGreaterThan(kinds.length);
        expect(
          labelDifferences(labelCensus(project), labelCensus(plan.project)),
        ).toEqual([]);
        const parts = plan.project.documents.flatMap(
          (document) => document.instances,
        );
        for (const original of project.documents[0]!.instances) {
          if (!original.reference) continue;
          const part = parts.find(
            (instance) => instance.reference === original.reference,
          );
          expect(part?.symbolId, original.reference).toBe(original.symbolId);
          expect(part?.symbolVariantId, original.reference).toBe(
            original.symbolVariantId,
          );
          expect(part && rnlPart(part)).toEqual(rnlPart(original));
        }
        const before = createDesignNetlistExport(project, { format });
        const after = createDesignNetlistExport(plan.project, { format });
        expect(after.status === "ready" && after.file.text).toBe(
          before.status === "ready" && before.file.text,
        );
      },
    );
  },
);

describe("legacy controlled-source diamond symbols", () => {
  it.each([
    ["spice", CONTROLLED_SOURCE_KINDS],
    ["spectre", ["vcvs", "vccs"]],
  ] as const)(
    "imports the old aliases as diamonds (%s)",
    async (format, kinds) => {
      const project = withImportedInstanceDisplays(controlledSources(kinds));
      const exported = createRnlExport(project, { format });
      if (exported.status !== "ready") throw new Error("export blocked");
      const standard = new Set(kinds.map((kind) => `$${kind.toUpperCase()}`));
      const written = await runtime.write({
        write: {
          ...exported.request,
          ops: [
            ...exported.request.ops.map((op) =>
              op.op === "set" && op.symbol && standard.has(op.symbol)
                ? { ...op, symbol: `$CANVAS_${op.symbol.slice(1)}_DIAMOND` }
                : op,
            ),
            {
              op: "use-package",
              level: "subckt:dut",
              name: "analog-canvas-extensions",
              version: "0.1",
            },
          ],
        },
        svg: false,
      });
      for (const kind of kinds)
        expect(written.text).toContain(
          `@SET-SYMBOL $CANVAS_${kind.toUpperCase()}_DIAMOND`,
        );
      const plan = await importRnl(written.text, format);
      expect(failures(plan)).toEqual([]);
      const sources = plan.project.documents
        .flatMap((document) => document.instances)
        .filter((part) => kinds.some((kind) => kind === part.symbolId));
      expect(sources).toHaveLength(kinds.length);
      for (const part of sources) {
        expect(part.symbolVariantId).toBe("diamond");
        const original = project.documents[0]!.instances.find(
          (instance) => instance.reference === part.reference,
        );
        if (!original) throw new Error("original source missing");
        expect(rnlPart(part)).toEqual(rnlPart(original));
      }
      const reexported = createRnlExport(plan.project, { format });
      if (reexported.status !== "ready") throw new Error("re-export blocked");
      const rewritten = await runtime.write({
        write: reexported.request,
        svg: false,
      });
      expect(rewritten.text).not.toContain("$CANVAS_");
      for (const kind of kinds)
        expect(rewritten.text).toContain(`@SET-SYMBOL $${kind.toUpperCase()}`);
      expect(
        labelDifferences(labelCensus(project), labelCensus(plan.project)),
      ).toEqual([]);
      const before = createDesignNetlistExport(project, { format });
      const after = createDesignNetlistExport(plan.project, { format });
      expect(after.status === "ready" && after.file.text).toBe(
        before.status === "ready" && before.file.text,
      );
    },
  );
});

/**
 * What a drawing must keep through RNL, Cell by Cell: its parts by kind (the
 * two op-amp variants RNL draws alike count as one), its junctions, the pins
 * its wires reach by part kind and pin, its wires by how they are drawn, and
 * its net and power labels.
 */
function drawingCensus(project: CircuitProject) {
  const kind = (symbolId: string) =>
    symbolId === "opamp-inputs-swapped" ? "opamp" : symbolId;
  const tally = (keys: readonly string[]) => {
    const counts = new Map<string, number>();
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
    return [...counts].sort().map(([key, count]) => `${key}:${count}`);
  };
  return Object.fromEntries(
    project.documents.map((document) => {
      const symbolOf = new Map(
        document.instances.map((instance) => [
          instance.id,
          kind(instance.symbolId),
        ]),
      );
      const reached = document.routes.flatMap((route) =>
        [
          route.start,
          ...route.legs.flatMap((leg) =>
            leg.to.kind === "endpoint" ? [leg.to.endpoint] : [],
          ),
        ].flatMap((endpoint) =>
          endpoint.kind === "terminal"
            ? [`${symbolOf.get(endpoint.instanceId)}.${endpoint.pinName}`]
            : [],
        ),
      );
      return [
        (document.netlist?.name ?? document.name).toLowerCase(),
        {
          parts: tally(
            document.instances.map((instance) => kind(instance.symbolId)),
          ),
          junctions: document.junctions.length,
          wiredPins: tally(reached),
          // Each wire as drawn, a power rail as a rail; a wire through a
          // junction stays one wire.
          wires: tally(
            document.routes.map((route) => route.presentation ?? "wire"),
          ),
          labels: tally(
            document.annotations
              .filter(
                (annotation) =>
                  annotation.kind === "net-label" ||
                  annotation.kind === "power-label",
              )
              .map((annotation) => annotation.kind),
          ),
        },
      ];
    }),
  );
}

describe("RNL round trip of examples as the editor opens them", () => {
  it("writes a Project the SPICE import brought in as Spectre the import reads again", async () => {
    // The SPICE import keeps a source's value as written (VINP's AC and
    // PULSE in its dc text); Spectre must print it in Spectre's own terms.
    const project = prepareNetlistExample(
      example("five-transistor-ota-sky130"),
      createDefaultNetlistExportPreferences().profiles.sky130,
    );
    const fromSpice = await roundTrip(project, "spice");
    const again = await roundTrip(fromSpice.project, "spectre");
    expect(failures(again)).toEqual([]);
    const spectre = createDesignNetlistExport(again.project, {
      format: "spectre",
    });
    expect(spectre.status === "ready" && spectre.file.text).toMatch(
      /^VINP \(.*\) vsource type=pulse val0=0\.9 val1=0\.91 /mu,
    );
  });

  // The editor binds an example's devices to the chosen process when it
  // opens one (prepareNetlistExample); these examples print only then, and
  // draw copied ground glyphs, SKY130 subcircuit MOS, Abstract's NMOS and
  // PMOS (on their stand-in cards) and nets named Vin+.
  it.each(
    [
      "common-source-amplifier",
      "current-mirror-loaded-differential-pair",
      "fully-differential-two-stage-op-amp",
      "simulation-common-source",
      "two-stage-op-amp",
      "five-transistor-ota-sky130",
    ].flatMap((name) =>
      (["sky130", "abstract"] as const).flatMap((process) => [
        [name, process, "spice"] as const,
        [name, process, "spectre"] as const,
      ]),
    ),
  )(
    "brings %s (%s, %s) back with every part, ground, wire and junction",
    async (name, process, format) => {
      const project = prepareNetlistExample(
        example(name),
        createDefaultNetlistExportPreferences().profiles[process],
      );
      const exported = createRnlExport(project, { format });
      if (exported.status !== "ready") throw new Error("export blocked");
      // Nothing the drawing shows is left out of the file.
      expect(
        exported.diagnostics
          .filter((item) =>
            ["RNL_GLYPH_UNCONNECTED", "RNL_WIRE_UNNAMED"].includes(item.code),
          )
          .map((item) => item.message),
      ).toEqual([]);
      const written = await runtime.write({
        write: exported.request,
        svg: false,
      });
      const plan = await importRnl(written.text, format);
      expect(
        plan.diagnostics
          .filter((item) => item.severity !== "info")
          .map((item) => `${item.code}: ${item.message}`),
      ).toEqual([]);
      // The editor takes the Project in as it takes any: valid, with its
      // MOS bulk defaults made explicit.
      expect(parseProject(JSON.stringify(plan.project))).toBeTruthy();
      expect(() =>
        materializeRazaviProjectBulkConnections(plan.project),
      ).not.toThrow();
      const before = drawingCensus(project);
      const after = drawingCensus(plan.project);
      for (const cell of cardNames(project).map((item) =>
        item.cell.toLowerCase(),
      ))
        expect(after[cell], cell).toEqual(before[cell]);
    },
  );
  // The library's five examples as the editor opens them: every label comes
  // back where it was, as big, with the text it showed, and none twice.
  it.each(
    [
      "common-source-amplifier",
      "two-stage-op-amp",
      "current-mirror-loaded-differential-pair",
      "fully-differential-two-stage-op-amp",
      "five-transistor-ota-sky130",
    ].flatMap((name) =>
      (["sky130", "abstract"] as const).flatMap((process) => [
        [name, process, "spice"] as const,
        [name, process, "spectre"] as const,
      ]),
    ),
  )(
    "brings every label of %s (%s, %s) back as drawn",
    async (name, process, format) => {
      const project = prepareNetlistExample(
        example(name),
        createDefaultNetlistExportPreferences().profiles[process],
      );
      const exported = createRnlExport(project, { format });
      if (exported.status !== "ready") throw new Error("export blocked");
      const written = await runtime.write({
        write: exported.request,
        svg: false,
      });
      const plan = await importRnl(written.text, format);
      expect(
        labelDifferences(labelCensus(project), labelCensus(plan.project)),
      ).toEqual([]);
    },
  );
});
