import { createEmptyDocument, createRoutePath } from "@icm/model";
import type { SchematicDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  formatNodeVoltage,
  operatingPointLabels,
} from "./operating-point-labels";

const resolver = new InMemorySymbolResolver(builtInSymbols);

/**
 * Two conductors: `net-named` carries an author-given name, `net-plain` does
 * not. Both are ordinary horizontal wires between two anchors.
 */
function twoNetDocument(): SchematicDocument {
  const document = createEmptyDocument("op", "Operating point");
  document.presentation.grid = 10;
  for (const [index, netId] of ["net-named", "net-plain"].entries()) {
    const y = 100 + index * 100;
    document.nets.push({ id: netId, terminals: [] });
    document.junctions.push(
      { id: `${netId}-a`, netId, position: { x: 100, y }, role: "route-anchor" },
      { id: `${netId}-b`, netId, position: { x: 300, y }, role: "route-anchor" },
    );
    document.routes.push(
      createRoutePath({
        id: `wire-${netId}`,
        netId,
        start: { kind: "junction", junctionId: `${netId}-a` },
        end: { kind: "junction", junctionId: `${netId}-b` },
        bends: [],
        modes: ["manual"],
      }),
    );
  }
  document.connectivityEvidence.push({
    id: "claim-vout",
    kind: "name-claim",
    netId: "net-named",
    name: "VOUT",
    scope: "global",
    owner: { kind: "global-declaration", sourceNetId: "net-named" },
  });
  return document;
}

const voltages = new Map([
  ["net-named", 0.9],
  ["net-plain", 0.0123],
]);

describe("operating point labels", () => {
  it("annotates the nets the author named and leaves the rest alone", () => {
    // The readability rule: a name is the author saying this net matters, so
    // it earns permanent screen space. An unnamed node does not, or a sixty
    // node circuit buries its own schematic.
    const labels = operatingPointLabels({
      document: twoNetDocument(),
      resolver,
      voltages,
      display: "named",
    });

    expect(labels.map((label) => label.netId)).toEqual(["net-named"]);
    expect(labels[0]).toMatchObject({
      netLabel: "VOUT",
      text: "900 mV",
      reason: "named",
    });
  });

  it("answers on demand for a net the author points at", () => {
    const document = twoNetDocument();
    const selected = operatingPointLabels({
      document,
      resolver,
      voltages,
      display: "named",
      selectedNetIds: ["net-plain"],
    });
    const hovered = operatingPointLabels({
      document,
      resolver,
      voltages,
      display: "named",
      hoveredNetId: "net-plain",
    });

    expect(selected.map((label) => [label.netId, label.reason])).toEqual([
      ["net-named", "named"],
      ["net-plain", "selected"],
    ]);
    expect(hovered.find((label) => label.netId === "net-plain")?.reason).toBe(
      "hovered",
    );
  });

  it("shows everything only when explicitly asked", () => {
    const labels = operatingPointLabels({
      document: twoNetDocument(),
      resolver,
      voltages,
      display: "all",
    });

    expect(labels.map((label) => label.netId)).toEqual([
      "net-named",
      "net-plain",
    ]);
    // A named net keeps saying it is named, even in the full picture.
    expect(labels[0]?.reason).toBe("named");
    expect(labels[1]?.reason).toBe("all");
  });

  it("anchors a badge on the conductor it describes", () => {
    const labels = operatingPointLabels({
      document: twoNetDocument(),
      resolver,
      voltages,
      display: "all",
    });

    // Midpoint of the wire, so the number sits beside the conductor it
    // belongs to rather than floating.
    expect(labels[0]?.at).toEqual({ x: 200, y: 100 });
    expect(labels[1]?.at).toEqual({ x: 200, y: 200 });
  });

  it("keeps a millivolt node readable instead of rounding it to zero", () => {
    // The whole point of an operating point is small differences; a format
    // that prints 0.00 V for a 12 mV node hides exactly what was asked.
    expect(formatNodeVoltage(0.0123)).toBe("12.3 mV");
    expect(formatNodeVoltage(-1.8)).toBe("-1.800 V");
    expect(formatNodeVoltage(2.5e-6)).toBe("2.50 µV");
    expect(formatNodeVoltage(0)).toBe("0 V");
  });
});
