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
      {
        id: `${netId}-a`,
        netId,
        position: { x: 100, y },
        role: "route-anchor",
      },
      {
        id: `${netId}-b`,
        netId,
        position: { x: 300, y },
        role: "route-anchor",
      },
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

  it("moves a badge off artwork instead of covering it", () => {
    // Found by rendering the rule over a real published circuit: the anchor
    // knew the conductor but not what was already drawn there, so a voltage
    // could land on a component's own label. A number that hides the part it
    // describes is worse than one that sits a little lower.
    const document = twoNetDocument();
    document.instances.push({
      id: "R9",
      symbolId: "resistor",
      // Straddling the named net's wire at y = 100, right where the badge
      // would otherwise go.
      placement: { position: { x: 200, y: 100 }, rotation: 0, mirror: "none" },
    } as SchematicDocument["instances"][number]);

    const labels = operatingPointLabels({
      document,
      resolver,
      voltages,
      display: "named",
    });

    expect(labels).toHaveLength(1);
    const at = labels[0]!.at;
    // Clear of the symbol: the resistor stands at x = 200, and a badge is
    // about 43 units wide, so anything within ~30 units would still cover it.
    expect(Math.abs(at.x - 200)).toBeGreaterThan(30);
    // And still on the conductor it describes — sliding along the wire, not
    // drifting into blank page where the reader must work out what it means.
    expect(at.x).toBeGreaterThanOrEqual(100);
    expect(at.x).toBeLessThanOrEqual(300);
    expect(at.y).toBe(100);
  });

  it("does not stack two badges on the same spot", () => {
    // Two nets whose best anchors coincide would otherwise print one voltage
    // over the other, which reads as a single wrong number.
    const document = twoNetDocument();
    document.junctions.forEach((junction) => {
      if (junction.netId === "net-plain") junction.position.y = 100;
    });
    const labels = operatingPointLabels({
      document,
      resolver,
      voltages,
      display: "all",
    });

    expect(labels).toHaveLength(2);
    expect(labels[0]!.at).not.toEqual(labels[1]!.at);
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
