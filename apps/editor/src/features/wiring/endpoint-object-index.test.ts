import { createEmptyDocument, type RouteEndpoint } from "@icm/model";
import { isVisibleEndpoint, resolveEndpointConnection } from "@icm/derived";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  buildEndpointObjectIndex,
  endpointNetId,
} from "./route-interaction-geometry";

const resolver = new InMemorySymbolResolver(builtInSymbols);

/**
 * The indexed lookup replaced a linear scan, so the only thing that has to
 * hold is that it answers exactly what the scan answered. This document is
 * built to exercise every branch that made them different: a terminal in one
 * Net, a terminal in no Net, a terminal in two Nets (first Net in document
 * order must win), a junction with and without a Net, and an unknown id.
 */
function endpointDocument() {
  const document = createEmptyDocument("endpoint-index", "Endpoint index");
  const pins = resolver
    .resolve("resistor")
    ?.definition.pins.map((pin) => pin.name);
  if (!pins || pins.length < 2) throw new Error("resistor pins unavailable");
  const [firstPin, secondPin] = pins as [string, string];

  document.instances.push(
    {
      id: "r1",
      reference: "R1",
      symbolId: "resistor",
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    },
    {
      id: "r2",
      reference: "R2",
      symbolId: "resistor",
      placement: { position: { x: 100, y: 0 }, rotation: 0, mirror: "none" },
    },
  );
  // net-late is pushed first on purpose: r1:firstPin belongs to both Nets, so
  // first-match order is observable.
  document.nets.push(
    {
      id: "net-late",
      terminals: [{ instanceId: "r1", pinName: firstPin }],
    },
    {
      id: "net-early",
      terminals: [
        { instanceId: "r1", pinName: firstPin },
        { instanceId: "r1", pinName: secondPin },
        { instanceId: "r2", pinName: firstPin },
      ],
    },
  );
  document.junctions.push(
    { id: "j1", netId: "net-early", position: { x: 0, y: 0 }, role: "branch" },
    { id: "j2", netId: "net-late", position: { x: 50, y: 0 }, role: "branch" },
  );

  const endpoints: RouteEndpoint[] = [
    { kind: "terminal", instanceId: "r1", pinName: firstPin },
    { kind: "terminal", instanceId: "r1", pinName: secondPin },
    { kind: "terminal", instanceId: "r2", pinName: firstPin },
    // r2's second pin is in no Net: the indexed path must answer null too.
    { kind: "terminal", instanceId: "r2", pinName: secondPin },
    { kind: "terminal", instanceId: "absent", pinName: firstPin },
    { kind: "junction", junctionId: "j1" },
    { kind: "junction", junctionId: "j2" },
    { kind: "junction", junctionId: "absent" },
  ];

  return { document, endpoints, firstPin };
}

describe("endpoint object index", () => {
  it("answers Net membership exactly as the linear scan did", () => {
    const { document, endpoints } = endpointDocument();
    const index = buildEndpointObjectIndex(document);

    for (const endpoint of endpoints) {
      expect(endpointNetId(document, endpoint, index)).toBe(
        endpointNetId(document, endpoint),
      );
    }
  });

  it("resolves every endpoint identically with and without the index", () => {
    const { document, endpoints } = endpointDocument();
    const index = buildEndpointObjectIndex(document);

    for (const endpoint of endpoints) {
      expect(
        resolveEndpointConnection(document, resolver, endpoint, index),
      ).toEqual(resolveEndpointConnection(document, resolver, endpoint));
      expect(isVisibleEndpoint(document, resolver, endpoint, index)).toBe(
        isVisibleEndpoint(document, resolver, endpoint),
      );
    }
  });

  it("keeps first-Net-wins order for a terminal in two Nets", () => {
    const { document, firstPin } = endpointDocument();
    const index = buildEndpointObjectIndex(document);

    expect(
      endpointNetId(
        document,
        { kind: "terminal", instanceId: "r1", pinName: firstPin },
        index,
      ),
    ).toBe("net-late");
  });
});
