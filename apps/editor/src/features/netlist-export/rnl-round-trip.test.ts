import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import type { CircuitProject } from "@icm/model";
import { createDesignNetlistExport } from "@icm/netlist";
import { parseProject } from "@icm/project-protocol";
import {
  createRnlExport,
  rnlBodyPortOrder,
  rnlOrient,
  type RnlSnapshot,
} from "@icm/rnl";
import { cellSymbolPinSlots } from "@icm/symbols";
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
      const same =
        part?.placement &&
        part.placement.position.x === original.placement.position.x &&
        part.placement.position.y === original.placement.position.y &&
        JSON.stringify(rnlOrient(part.placement)) ===
          JSON.stringify(rnlOrient(original.placement)) &&
        part.symbolId === original.symbolId &&
        (part.symbolVariantId ?? null) === (original.symbolVariantId ?? null);
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
    const { project: drawn } = await roundTrip(project);
    const cell = drawn.documents.find(
      (item) => item.netlist?.name === document.netlist?.name,
    )!;
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
    expect(cell.drafting?.objects).toEqual([
      expect.objectContaining({
        kind: "floating-symbol",
        symbolId: "resistor",
        anchor: { kind: "free", position: { x: 1100, y: -300 } },
        transform: { rotation: 90, mirror: "none" },
      }),
    ]);
  });
});
