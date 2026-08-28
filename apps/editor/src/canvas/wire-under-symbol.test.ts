import { createEmptyDocument, createRoutePath } from "@icm/model";
import { resolveDocumentRoutingGeometry } from "@icm/derived";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { deriveWireUnderSymbolWarnings } from "./wire-under-symbol";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function fixture(resistorAt: { x: number; y: number }) {
  const document = createEmptyDocument("doc", "Overlap");
  document.instances.push(
    {
      id: "A",
      symbolId: "resistor",
      placement: { position: { x: 100, y: 300 }, rotation: 0, mirror: "none" },
      netlist: { reference: "A", parameters: {} },
    },
    {
      id: "B",
      symbolId: "resistor",
      placement: { position: { x: 500, y: 300 }, rotation: 0, mirror: "none" },
      netlist: { reference: "B", parameters: {} },
    },
    {
      id: "RX",
      symbolId: "resistor",
      placement: { position: resistorAt, rotation: 0, mirror: "none" },
      netlist: { reference: "RX", parameters: {} },
    },
  );
  document.nets.push({
    id: "net-w",
    terminals: [
      { instanceId: "A", pinName: "2" },
      { instanceId: "B", pinName: "2" },
    ],
  });
  document.routes.push(
    createRoutePath({
      id: "route-w",
      netId: "net-w",
      start: { kind: "terminal", instanceId: "A", pinName: "2" },
      end: { kind: "terminal", instanceId: "B", pinName: "2" },
      bends: [
        { x: 100, y: 400 },
        { x: 500, y: 400 },
      ],
      modes: ["manual", "manual", "manual"],
    }),
  );
  const geometry = resolveDocumentRoutingGeometry(document, resolver);
  const records = document.routes.flatMap((route) => {
    const resolved = geometry.routes.get(route.id);
    return resolved ? [{ route, geometry: resolved }] : [];
  });
  return { document, records };
}

describe("deriveWireUnderSymbolWarnings", () => {
  it("flags the span a symbol body covers", () => {
    // RX parked so its body straddles the horizontal run at y=400.
    const { document, records } = fixture({ x: 300, y: 400 });
    const warnings = deriveWireUnderSymbolWarnings(document, resolver, records);
    const hit = warnings.filter((warning) => warning.instanceId === "RX");
    expect(hit.length).toBeGreaterThan(0);
    expect(hit[0]!.routeId).toBe("route-w");
    expect(hit[0]!.from.y).toBe(400);
    expect(hit[0]!.to.y).toBe(400);
  });

  it("does not flag wires that stay clear of symbol bodies", () => {
    const { document, records } = fixture({ x: 300, y: 200 });
    expect(
      deriveWireUnderSymbolWarnings(document, resolver, records).filter(
        (warning) => warning.instanceId === "RX",
      ),
    ).toEqual([]);
  });

  it("does not flag a pin's own stem skimming the outline", () => {
    // Endpoint resistors A and B connect to the route legitimately; their
    // own connection stems must not be reported.
    const { document, records } = fixture({ x: 300, y: 200 });
    const warnings = deriveWireUnderSymbolWarnings(document, resolver, records);
    expect(
      warnings.filter((warning) => ["A", "B"].includes(warning.instanceId)),
    ).toEqual([]);
  });
});
