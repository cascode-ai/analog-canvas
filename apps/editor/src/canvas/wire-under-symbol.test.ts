import { createEmptyDocument, createRoutePath } from "@icm/model";
import {
  resolveDocumentRoutingGeometry,
  resolveEndpointConnection,
} from "@icm/derived";
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

  function nmosFixture(
    nmosAt: { x: number; y: number },
    options: { gateOnNet?: boolean } = {},
  ) {
    const { document } = fixture({ x: 300, y: 200 });
    document.instances.push({
      id: "M1",
      symbolId: "nmos",
      placement: { position: nmosAt, rotation: 0, mirror: "none" },
      netlist: { reference: "M1", parameters: {} },
    });
    if (options.gateOnNet !== false) {
      document.nets[0]!.terminals.push({ instanceId: "M1", pinName: "G" });
    }
    const geometry = resolveDocumentRoutingGeometry(document, resolver);
    const records = document.routes.flatMap((route) => {
      const resolved = geometry.routes.get(route.id);
      return resolved ? [{ route, geometry: resolved }] : [];
    });
    return { document, records };
  }

  it("exempts a wire riding the gate lead line straight through a MOS", () => {
    // The bias-rail idiom: the y=400 run passes through M1's body exactly on
    // the gate lead line (gate contact at x-20 of the placement), covering
    // the contact of a gate terminal the Net declares. The span is that
    // terminal's own connection and stays quiet.
    const { document, records } = nmosFixture({ x: 300, y: 400 });
    expect(
      deriveWireUnderSymbolWarnings(document, resolver, records).filter(
        (warning) => warning.instanceId === "M1",
      ),
    ).toEqual([]);
  });

  it("still flags a gate-line wire whose Net does not include the gate", () => {
    // Same geometry, but M1's gate is not a terminal of the wire's Net: the
    // component is merely parked on a foreign wire and looks connected
    // without being so.
    const { document, records } = nmosFixture(
      { x: 300, y: 400 },
      { gateOnNet: false },
    );
    expect(
      deriveWireUnderSymbolWarnings(document, resolver, records).filter(
        (warning) => warning.instanceId === "M1",
      ),
    ).not.toEqual([]);
  });

  it("still flags a wire crossing a MOS body off the lead lines", () => {
    // Shifted 10 units, the same run crosses the body at local y=+10 where
    // no pin lead runs horizontally.
    const { document, records } = nmosFixture({ x: 300, y: 390 });
    expect(
      deriveWireUnderSymbolWarnings(document, resolver, records).filter(
        (warning) => warning.instanceId === "M1",
      ),
    ).not.toEqual([]);
  });

  it("still flags a collinear span that never reaches the pin contact", () => {
    // A stub starting inside the body on the gate line but east of the gate
    // contact is buried, not connected.
    const { document } = nmosFixture({ x: 300, y: 400 });
    document.routes.length = 0;
    document.junctions.push({
      id: "J",
      netId: "net-w",
      position: { x: 305, y: 400 },
    });
    document.routes.push(
      createRoutePath({
        id: "route-stub",
        netId: "net-w",
        start: { kind: "junction", junctionId: "J" },
        end: { kind: "terminal", instanceId: "B", pinName: "2" },
        bends: [{ x: 500, y: 400 }],
        modes: ["manual", "manual"],
      }),
    );
    const geometry = resolveDocumentRoutingGeometry(document, resolver);
    const records = document.routes.flatMap((route) => {
      const resolved = geometry.routes.get(route.id);
      return resolved ? [{ route, geometry: resolved }] : [];
    });
    const warnings = deriveWireUnderSymbolWarnings(document, resolver, records);
    expect(
      warnings.filter((warning) => warning.instanceId === "M1"),
    ).not.toEqual([]);
  });

  function verticalFixture(middle: {
    id: string;
    symbolId: string;
    pinNamesOnNet: readonly string[];
  }) {
    const document = createEmptyDocument("doc", "Axis");
    document.instances.push(
      {
        id: "C",
        symbolId: "resistor",
        placement: {
          position: { x: 300, y: 150 },
          rotation: 0,
          mirror: "none",
        },
        netlist: { reference: "C", parameters: {} },
      },
      {
        id: "D",
        symbolId: "resistor",
        placement: {
          position: { x: 300, y: 650 },
          rotation: 0,
          mirror: "none",
        },
        netlist: { reference: "D", parameters: {} },
      },
      {
        id: middle.id,
        symbolId: middle.symbolId,
        placement: {
          position: { x: 300, y: 400 },
          rotation: 0,
          mirror: "none",
        },
        netlist: { reference: middle.id, parameters: {} },
      },
    );
    document.nets.push({
      id: "net-v",
      terminals: [
        { instanceId: "C", pinName: "2" },
        { instanceId: "D", pinName: "1" },
        ...middle.pinNamesOnNet.map((pinName) => ({
          instanceId: middle.id,
          pinName,
        })),
      ],
    });
    document.routes.push(
      createRoutePath({
        id: "route-v",
        netId: "net-v",
        start: { kind: "terminal", instanceId: "C", pinName: "2" },
        end: { kind: "terminal", instanceId: "D", pinName: "1" },
        bends: [],
        modes: ["manual"],
      }),
    );
    const geometry = resolveDocumentRoutingGeometry(document, resolver);
    const records = document.routes.flatMap((route) => {
      const resolved = geometry.routes.get(route.id);
      return resolved ? [{ route, geometry: resolved }] : [];
    });
    return { document, records };
  }

  it("flags a wire tunneling between both leads of a resistor even on its pin axis", () => {
    // The x=300 run rides both of RX's pin leads, so the wire shorts through
    // the component while looking like a series insertion. Declaring the
    // bonded terminals does not quiet it: two ridden leads always warn.
    const { document, records } = verticalFixture({
      id: "RX",
      symbolId: "resistor",
      pinNamesOnNet: ["1", "2"],
    });
    expect(
      deriveWireUnderSymbolWarnings(document, resolver, records).filter(
        (warning) => warning.instanceId === "RX",
      ),
    ).not.toEqual([]);
  });

  it("exempts a vertical wire riding a ground port's single connected lead", () => {
    // Ground has one pin ("0", north) whose lead the x=300 run rides; with
    // the terminal on the Net this is the port's own connection.
    const { document, records } = verticalFixture({
      id: "G1",
      symbolId: "ground",
      pinNamesOnNet: ["0"],
    });
    expect(
      deriveWireUnderSymbolWarnings(document, resolver, records).filter(
        (warning) => warning.instanceId === "G1",
      ),
    ).toEqual([]);
  });

  function rotatedResistorFixture(wireX: (contact: { x: number }) => number) {
    // A horizontal resistor (rotation 90). Its artwork is a path primitive,
    // so the envelope falls back to the declaration viewBox, whose padding
    // equals the body clearance: the deflated box edges land exactly on the
    // pin contacts.
    const document = createEmptyDocument("doc", "Corner");
    document.instances.push({
      id: "RX",
      symbolId: "resistor",
      placement: { position: { x: 300, y: 400 }, rotation: 90, mirror: "none" },
      netlist: { reference: "RX", parameters: {} },
    });
    const contact = resolveEndpointConnection(document, resolver, {
      kind: "terminal",
      instanceId: "RX",
      pinName: "1",
    })!.contactPoint;
    const x = wireX(contact);
    document.nets.push({ id: "net-c", terminals: [] });
    document.junctions.push(
      { id: "J1", netId: "net-c", position: { x, y: 500 } },
      { id: "J2", netId: "net-c", position: { x, y: 300 } },
    );
    document.routes.push(
      createRoutePath({
        id: "route-c",
        netId: "net-c",
        start: { kind: "junction", junctionId: "J1" },
        end: { kind: "junction", junctionId: "J2" },
        bends: [],
        modes: ["manual"],
      }),
    );
    const geometry = resolveDocumentRoutingGeometry(document, resolver);
    const records = document.routes.flatMap((route) => {
      const resolved = geometry.routes.get(route.id);
      return resolved ? [{ route, geometry: resolved }] : [];
    });
    return { document, records };
  }

  it("stays quiet for a wire running exactly along the pin-contact edge", () => {
    // The reported ground-to-resistor corner: a vertical wire at the left
    // pin contact of a horizontal resistor lies exactly on the deflated box
    // boundary. Zero penetration depth is skimming, not burial.
    const { document, records } = rotatedResistorFixture(
      (contact) => contact.x,
    );
    expect(
      deriveWireUnderSymbolWarnings(document, resolver, records).filter(
        (warning) => warning.instanceId === "RX",
      ),
    ).toEqual([]);
  });

  it("still flags a wire strictly inside the body box", () => {
    // Six units inboard of the contact edge the same vertical wire crosses
    // real artwork and keeps its warning.
    const { document, records } = rotatedResistorFixture((contact) =>
      contact.x < 300 ? contact.x + 6 : contact.x - 6,
    );
    expect(
      deriveWireUnderSymbolWarnings(document, resolver, records).filter(
        (warning) => warning.instanceId === "RX",
      ),
    ).not.toEqual([]);
  });
});
