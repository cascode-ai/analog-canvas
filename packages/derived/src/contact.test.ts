import { createRoutePath } from "@icm/model";
import { createEmptyDocument } from "@icm/model";
import type { RouteEndpoint, SchematicDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  contactRequiresJunctionDot,
  deriveDirectContactDelta,
  deriveDocumentContactEvidence,
} from "./contact.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

interface RouteSpec {
  id: string;
  from: { x: number; y: number } | { instanceId: string; pinName: string };
  to: { x: number; y: number } | { instanceId: string; pinName: string };
}

/** One-net document: loose anchors for point ends, terminals for pin ends. */
function documentWith(
  routes: RouteSpec[],
  instances: Array<{
    id: string;
    symbolId: string;
    position: { x: number; y: number };
    rotation?: 0 | 90 | 180 | 270;
    mirror?: "none" | "x";
    pins: string[];
  }> = [],
): SchematicDocument {
  const document = createEmptyDocument("contact", "Contact");
  const net = {
    id: "net-1",
    scope: "local" as const,
    terminals: [] as Array<{ instanceId: string; pinName: string }>,
  };
  document.nets.push(net);
  for (const instance of instances) {
    document.instances.push({
      id: instance.id,
      symbolId: instance.symbolId,
      symbolVariantId:
        instance.symbolId === "pmos" || instance.symbolId === "nmos"
          ? "textbook-3terminal"
          : undefined,
      placement: {
        position: instance.position,
        rotation: instance.rotation ?? 0,
        mirror: instance.mirror ?? "none",
      },
    });
    for (const pinName of instance.pins) {
      net.terminals.push({ instanceId: instance.id, pinName });
    }
  }
  let anchorSuffix = 0;
  const endpointFor = (end: RouteSpec["from"]): RouteEndpoint => {
    if ("instanceId" in end) {
      return {
        kind: "terminal",
        instanceId: end.instanceId,
        pinName: end.pinName,
      };
    }
    anchorSuffix += 1;
    const id = `anchor-${anchorSuffix}`;
    document.junctions.push({
      id,
      netId: net.id,
      position: { x: end.x, y: end.y },
      role: "route-anchor",
    });
    return { kind: "junction", junctionId: id };
  };
  for (const route of routes) {
    document.routes.push(
      createRoutePath({
        id: route.id,
        netId: net.id,
        start: endpointFor(route.from),
        end: endpointFor(route.to),
        bends: [],
        modes: ["manual"],
      }),
    );
  }
  return document;
}

function dotAt(
  document: SchematicDocument,
  point: { x: number; y: number },
): boolean {
  const evidence = deriveDocumentContactEvidence(document, resolver);
  const contact = evidence.contacts.find(
    (candidate) =>
      candidate.point.x === point.x && candidate.point.y === point.y,
  );
  if (!contact) throw new Error(`no contact at ${point.x},${point.y}`);
  return contactRequiresJunctionDot(contact);
}

describe("contactRequiresJunctionDot", () => {
  it("keeps a straight two-arm join dotless", () => {
    const document = documentWith([
      { id: "left", from: { x: -60, y: 0 }, to: { x: 0, y: 0 } },
      { id: "right", from: { x: 0, y: 0 }, to: { x: 60, y: 0 } },
    ]);
    expect(dotAt(document, { x: 0, y: 0 })).toBe(false);
  });

  it("dots a parked endpoint riding another conductor's interior", () => {
    // The branch ends ON the through wire without the model splitting it —
    // the through arms still count, so the visual T carries its dot.
    const teed = documentWith([
      { id: "through", from: { x: -60, y: 0 }, to: { x: 60, y: 0 } },
      { id: "branch", from: { x: 0, y: 60 }, to: { x: 0, y: 0 } },
    ]);
    expect(dotAt(teed, { x: 0, y: 0 })).toBe(true);

    // A collinear park is one continuous line, not a branch: no dot.
    const inline = documentWith([
      { id: "through", from: { x: -60, y: 0 }, to: { x: 60, y: 0 } },
      { id: "tail", from: { x: -120, y: 0 }, to: { x: 0, y: 0 } },
    ]);
    expect(dotAt(inline, { x: 0, y: 0 })).toBe(false);
  });

  it("dots a three-way route branch", () => {
    const document = documentWith([
      { id: "left", from: { x: -60, y: 0 }, to: { x: 0, y: 0 } },
      { id: "right", from: { x: 0, y: 0 }, to: { x: 60, y: 0 } },
      { id: "down", from: { x: 0, y: 0 }, to: { x: 0, y: 60 } },
    ]);
    expect(dotAt(document, { x: 0, y: 0 })).toBe(true);
  });

  it("dots a perpendicular pin tapped by a straight-through conductor", () => {
    // Resistor pin 1 sits at (0,0): body at (0,20), pin 1 local (0,-20).
    const document = documentWith(
      [
        {
          id: "left",
          from: { x: -60, y: 0 },
          to: { instanceId: "R1", pinName: "1" },
        },
        {
          id: "right",
          from: { instanceId: "R1", pinName: "1" },
          to: { x: 60, y: 0 },
        },
      ],
      [
        {
          id: "R1",
          symbolId: "resistor",
          position: { x: 0, y: 20 },
          pins: ["1"],
        },
      ],
    );
    expect(dotAt(document, { x: 0, y: 0 })).toBe(true);
  });

  it("keeps three collinear MOS Gates dotless at the middle terminal", () => {
    const document = documentWith(
      [
        {
          id: "left",
          from: { instanceId: "M3", pinName: "G" },
          to: { instanceId: "M2", pinName: "G" },
        },
        {
          id: "right",
          from: { instanceId: "M2", pinName: "G" },
          to: { instanceId: "M1", pinName: "G" },
        },
      ],
      [
        { id: "M3", symbolId: "nmos", position: { x: 0, y: 0 }, pins: ["G"] },
        { id: "M2", symbolId: "nmos", position: { x: 60, y: 0 }, pins: ["G"] },
        { id: "M1", symbolId: "nmos", position: { x: 120, y: 0 }, pins: ["G"] },
      ],
    );
    // Gate pins resolve at x = instance.x - 20. The M2 stem and right-hand
    // Route share one direction, leaving only the two visible line directions.
    expect(dotAt(document, { x: 40, y: 0 })).toBe(false);
  });

  it("keeps a single right-angle Route from a terminal dotless", () => {
    const document = documentWith(
      [
        {
          id: "turn",
          from: { x: -20, y: 60 },
          to: { instanceId: "M1", pinName: "G" },
        },
      ],
      [{ id: "M1", symbolId: "pmos", position: { x: 0, y: 0 }, pins: ["G"] }],
    );
    expect(dotAt(document, { x: -20, y: 0 })).toBe(false);
  });

  it("uses rotated terminal directions when classifying collinear Gates", () => {
    const document = documentWith(
      [
        {
          id: "top",
          from: { instanceId: "M3", pinName: "G" },
          to: { instanceId: "M2", pinName: "G" },
        },
        {
          id: "bottom",
          from: { instanceId: "M2", pinName: "G" },
          to: { instanceId: "M1", pinName: "G" },
        },
      ],
      [
        {
          id: "M3",
          symbolId: "nmos",
          position: { x: 0, y: 0 },
          rotation: 90,
          pins: ["G"],
        },
        {
          id: "M2",
          symbolId: "nmos",
          position: { x: 0, y: 60 },
          rotation: 90,
          pins: ["G"],
        },
        {
          id: "M1",
          symbolId: "nmos",
          position: { x: 0, y: 120 },
          rotation: 90,
          pins: ["G"],
        },
      ],
    );
    expect(dotAt(document, { x: 0, y: 40 })).toBe(false);
  });

  it("uses mirrored terminal directions when classifying collinear Gates", () => {
    const document = documentWith(
      [
        {
          id: "left",
          from: { instanceId: "M3", pinName: "G" },
          to: { instanceId: "M2", pinName: "G" },
        },
        {
          id: "right",
          from: { instanceId: "M2", pinName: "G" },
          to: { instanceId: "M1", pinName: "G" },
        },
      ],
      [
        {
          id: "M3",
          symbolId: "nmos",
          position: { x: 0, y: 0 },
          mirror: "x",
          pins: ["G"],
        },
        {
          id: "M2",
          symbolId: "nmos",
          position: { x: 60, y: 0 },
          mirror: "x",
          pins: ["G"],
        },
        {
          id: "M1",
          symbolId: "nmos",
          position: { x: 120, y: 0 },
          mirror: "x",
          pins: ["G"],
        },
      ],
    );
    expect(dotAt(document, { x: 80, y: 0 })).toBe(false);
  });

  it("dots a true three-direction branch containing 45-degree arms", () => {
    const document = documentWith([
      { id: "northwest", from: { x: -40, y: -40 }, to: { x: 0, y: 0 } },
      { id: "southeast", from: { x: 0, y: 0 }, to: { x: 40, y: 40 } },
      { id: "east", from: { x: 0, y: 0 }, to: { x: 60, y: 0 } },
    ]);
    expect(dotAt(document, { x: 0, y: 0 })).toBe(true);
  });

  it("keeps two coincident pins dotless but dots three coincident pins", () => {
    const twoPins = documentWith(
      [],
      [
        { id: "M1", symbolId: "nmos", position: { x: 0, y: 0 }, pins: ["G"] },
        { id: "M2", symbolId: "nmos", position: { x: 0, y: 0 }, pins: ["G"] },
      ],
    );
    expect(dotAt(twoPins, { x: -20, y: 0 })).toBe(false);

    const threePins = documentWith(
      [],
      [
        { id: "M1", symbolId: "nmos", position: { x: 0, y: 0 }, pins: ["G"] },
        { id: "M2", symbolId: "nmos", position: { x: 0, y: 0 }, pins: ["G"] },
        { id: "M3", symbolId: "nmos", position: { x: 0, y: 0 }, pins: ["G"] },
      ],
    );
    expect(dotAt(threePins, { x: -20, y: 0 })).toBe(true);
  });

  it("never dots collinear overlapping arms ending on one pin", () => {
    // The reported PMOS-gate regression: two same-net routes arrive at the
    // gate from the SAME direction (their drawn segments lie on top of each
    // other), plus the pin. Visually this is one wire meeting one pin.
    const document = documentWith(
      [
        {
          id: "near",
          from: { x: -20, y: 70 },
          to: { instanceId: "M1", pinName: "G" },
        },
        {
          id: "far",
          from: { x: -20, y: 80 },
          to: { instanceId: "M1", pinName: "G" },
        },
      ],
      [{ id: "M1", symbolId: "pmos", position: { x: 0, y: 0 }, pins: ["G"] }],
    );
    // PMOS gate pin resolves at (-20, 0).
    expect(dotAt(document, { x: -20, y: 0 })).toBe(false);
  });

  it("still dots coincident pins joined by one arm", () => {
    // Two resistor pins meet at (0,0) (bodies above and below), plus a wire:
    // per-terminal counting is preserved even though the arms overlap none.
    const document = documentWith(
      [
        {
          id: "tap",
          from: { x: -60, y: 0 },
          to: { instanceId: "R1", pinName: "1" },
        },
      ],
      [
        {
          id: "R1",
          symbolId: "resistor",
          position: { x: 0, y: 20 },
          pins: ["1"],
        },
        {
          id: "R2",
          symbolId: "resistor",
          position: { x: 0, y: -20 },
          rotation: 180,
          pins: ["1"],
        },
      ],
    );
    expect(dotAt(document, { x: 0, y: 0 })).toBe(true);
  });

  it("dots a pin contact with three distinct visible directions", () => {
    const document = documentWith(
      [
        {
          id: "vertical",
          from: { x: -20, y: 70 },
          to: { instanceId: "M1", pinName: "G" },
        },
        {
          id: "horizontal",
          from: { x: -80, y: 0 },
          to: { instanceId: "M1", pinName: "G" },
        },
      ],
      [{ id: "M1", symbolId: "pmos", position: { x: 0, y: 0 }, pins: ["G"] }],
    );
    expect(dotAt(document, { x: -20, y: 0 })).toBe(true);
  });
});

describe("deriveDirectContactDelta", () => {
  it("identifies endpoint pairs rather than treating page position as identity", () => {
    const before = documentWith(
      [],
      [
        { id: "M1", symbolId: "nmos", position: { x: 0, y: 0 }, pins: ["G"] },
        { id: "M2", symbolId: "nmos", position: { x: 0, y: 0 }, pins: ["G"] },
      ],
    );
    const movedTogether = structuredClone(before);
    for (const instance of movedTogether.instances) {
      instance.placement!.position.x += 20;
    }
    const retained = deriveDirectContactDelta(before, movedTogether, resolver);
    const gatePairId = "terminal:M1:G|terminal:M2:G";
    expect(retained.retained.map((pair) => pair.id)).toContain(gatePairId);
    expect(retained.gained).toEqual([]);
    expect(retained.lost).toEqual([]);

    const movedApart = structuredClone(before);
    movedApart.instances.find(
      (instance) => instance.id === "M1",
    )!.placement!.position.x += 20;
    const lost = deriveDirectContactDelta(before, movedApart, resolver);
    expect(lost.lost.map((pair) => pair.id)).toContain(gatePairId);
  });
});
