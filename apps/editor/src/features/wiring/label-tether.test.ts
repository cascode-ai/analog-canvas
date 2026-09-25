import {
  razaviTextbookProfile,
  resolveDocumentRoutingGeometry,
  resolveEndpointConnection,
} from "@icm/derived";
import { createEmptyDocument, createRoutePath } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { labelsOwnedBy, resolveLabelTethers } from "./label-tether";
import { instanceHitBox } from "./route-interaction-geometry";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function fixture() {
  const document = createEmptyDocument("main", "Main");
  document.instances.push(
    {
      id: "R1",
      reference: "R1",
      symbolId: "resistor",
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      netlist: { parameters: { value: "1k" } },
    },
    {
      id: "P1",
      symbolId: "port",
      placement: { position: { x: 200, y: 0 }, rotation: 0, mirror: "none" },
    },
  );
  const at = (x: number, y: number) => ({ x, y });
  document.annotations.push(
    {
      id: "R1-name",
      kind: "instance-label",
      binding: { kind: "instance-reference", instanceId: "R1" },
      anchor: {
        kind: "object",
        objectId: "R1",
        localOffset: at(80, 0),
        fallbackPosition: at(80, 0),
      },
      alignment: "start",
      rotation: 0,
      locked: false,
    },
    {
      id: "R1-hidden",
      kind: "instance-value",
      binding: { kind: "instance-value", instanceId: "R1" },
      visible: false,
      anchor: {
        kind: "object",
        objectId: "R1",
        localOffset: at(20, 20),
        fallbackPosition: at(20, 20),
      },
      alignment: "start",
      rotation: 0,
      locked: false,
    },
    {
      id: "P1-name",
      kind: "instance-label",
      binding: { kind: "cell-terminal-name", terminalId: "terminal-p1" },
      anchor: {
        kind: "object",
        objectId: "P1",
        localOffset: at(40, -30),
        fallbackPosition: at(240, -30),
      },
      alignment: "start",
      rotation: 0,
      locked: false,
    },
  );
  document.nets.push({ id: "net", terminals: [] });
  document.junctions.push(
    { id: "j1", netId: "net", position: at(0, 300), role: "route-anchor" },
    { id: "j2", netId: "net", position: at(100, 300), role: "route-anchor" },
  );
  document.routes.push(
    createRoutePath({
      id: "wire",
      netId: "net",
      start: { kind: "junction", junctionId: "j1" },
      end: { kind: "junction", junctionId: "j2" },
      bends: [],
      modes: ["manual"],
    }),
  );
  const legId = document.routes[0]!.legs[0]!.id;
  document.annotations.push({
    id: "wire-name",
    kind: "net-label",
    netId: "net",
    binding: { kind: "net-name", netId: "net" },
    anchor: {
      kind: "route",
      routeId: "wire",
      legId,
      t: 0.3,
      normalOffset: -8,
      direction: "forward",
      orientation: "follow",
      fallbackPosition: at(30, 292),
    },
    alignment: "start",
    rotation: 0,
    locked: false,
  });
  const routing = resolveDocumentRoutingGeometry(document, resolver);
  const routeGeometryRecords = document.routes.flatMap((route) => {
    const geometry = routing.routes.get(route.id);
    return geometry ? [{ route, geometry }] : [];
  });
  return {
    document,
    context: {
      document,
      resolver,
      styleProfile: razaviTextbookProfile,
      routeGeometryRecords,
    },
  };
}

describe("label tethers", () => {
  it("joins a part's name to the part's nearest edge", () => {
    const { document, context } = fixture();
    const [tether] = resolveLabelTethers(context, ["R1-name"]);
    const body = instanceHitBox(document.instances[0]!, resolver)!;
    expect(tether).toMatchObject({ kind: "part", ownerId: "R1" });
    // The far end lies on the body's right edge; the near end is to its right.
    expect(tether!.target.x).toBe(body.x + body.width);
    expect(tether!.label.x).toBeGreaterThan(tether!.target.x);
  });

  it("joins a pin's name to its pin and a Net Label to its wire tap", () => {
    const { document, context } = fixture();
    const [pin, wire] = resolveLabelTethers(context, ["P1-name", "wire-name"]);
    const pinName = resolver.resolve("port")!.definition.pins[0]!.name;
    expect(pin).toMatchObject({
      kind: "pin",
      ownerId: "P1",
      target: resolveEndpointConnection(document, resolver, {
        kind: "terminal",
        instanceId: "P1",
        pinName,
      })!.contactPoint,
    });
    expect(wire).toMatchObject({
      kind: "wire",
      ownerId: "wire",
      target: { x: 30, y: 300 },
    });
  });

  it("skips hidden labels and lists a lone part's visible ones", () => {
    const { document, context } = fixture();
    expect(resolveLabelTethers(context, ["R1-hidden"])).toEqual([]);
    expect(labelsOwnedBy(document, "R1")).toEqual(["R1-name"]);
    expect(labelsOwnedBy(document, "P1")).toEqual(["P1-name"]);
  });
});
