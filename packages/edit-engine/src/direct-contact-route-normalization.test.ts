import { createEmptyDocument, createRoutePath } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { normalizeRedundantDirectContactRoutes } from "./direct-contact-route-normalization.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function legacySwitchContact() {
  const document = createEmptyDocument("switch-contact", "SwitchContact");
  document.instances.push(
    {
      id: "X1",
      symbolId: "ideal-switch",
      placement: {
        position: { x: 500, y: 200 },
        rotation: 0,
        mirror: "none",
      },
    },
    {
      id: "P1",
      symbolId: "port",
      placement: {
        position: { x: 510, y: 200 },
        rotation: 0,
        mirror: "none",
      },
    },
  );
  document.nets.push({
    id: "net-contact",
    terminals: [
      { instanceId: "X1", pinName: "2" },
      { instanceId: "P1", pinName: "P" },
    ],
  });
  document.netlist!.terminals.push({
    id: "terminal-p1",
    name: "OUT",
    netId: "net-contact",
    direction: "passive",
    interfaceInstanceIds: ["P1"],
  });
  document.routes.push(
    createRoutePath({
      id: "legacy-ten-unit-route",
      netId: "net-contact",
      start: { kind: "terminal", instanceId: "P1", pinName: "P" },
      end: { kind: "terminal", instanceId: "X1", pinName: "2" },
      bends: [],
      modes: ["manual"],
    }),
  );
  return document;
}

describe("legacy direct-contact Route normalization", () => {
  it("removes the Route collapsed by the shorter switch lead", () => {
    const document = legacySwitchContact();

    const result = normalizeRedundantDirectContactRoutes(document, resolver);

    expect(result.changed).toBe(true);
    expect([...result.removedRouteIds]).toEqual(["legacy-ten-unit-route"]);
    expect(document.routes).toEqual([]);
    expect(document.nets[0]!.terminals).toEqual([
      { instanceId: "X1", pinName: "2" },
      { instanceId: "P1", pinName: "P" },
    ]);
  });

  it("does not discard a collapsed Route with an external layout owner", () => {
    const document = legacySwitchContact();
    document.layoutGroups.push({
      id: "group-route-owner",
      kind: "custom",
      objectIds: ["legacy-ten-unit-route"],
      locked: false,
    });

    const result = normalizeRedundantDirectContactRoutes(document, resolver);

    expect(result.changed).toBe(false);
    expect([...result.protectedRouteIds]).toEqual(["legacy-ten-unit-route"]);
    expect(document.routes).toHaveLength(1);
  });
});
