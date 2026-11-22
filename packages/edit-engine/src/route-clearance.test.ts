import {
  createEmptyDocument,
  createRoutePath,
  type SchematicDocument,
} from "@icm/model";
import { deriveNetConnectivityContext } from "@icm/derived";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";
import { createRouteClearance, meetOwnNet } from "./route-clearance.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
function clearance(document: SchematicDocument) {
  return createRouteClearance(
    document,
    resolver,
    deriveNetConnectivityContext(document, resolver),
    { logicalIds: new Set(), endpointKeys: new Set() },
  );
}

describe("route clearance", () => {
  // M1 draws no body pin at (120, 100), nor M2 at (180, 100): the
  // 3-terminal variant hides B and its lead.
  const pair = () => {
    const document = createEmptyDocument("doc", "Pair");
    document.instances = [
      { id: "M1", x: 100, mirror: "none" as const },
      { id: "M2", x: 200, mirror: "horizontal" as const },
    ].map(({ id, x, mirror }) => ({
      id,
      reference: id,
      symbolId: "pmos",
      symbolVariantId: "textbook-3terminal",
      placement: { position: { x, y: 100 }, rotation: 0, mirror },
    }));
    return document;
  };

  it("lets a wire pass where a 3-terminal MOS hides its body pin", () => {
    const check = clearance(pair());
    expect(
      check.conflict(
        [
          { x: 114, y: 100 },
          { x: 186, y: 100 },
        ],
        [undefined, undefined],
      ),
    ).toBeNull();
    expect(
      check.conflict(
        [
          { x: 90, y: 100 },
          { x: 186, y: 100 },
        ],
        [undefined, undefined],
      ),
    ).toMatch(/^passes through M1 /u);
  });

  it("names where a path crosses another Net's wire, not where it ends on one", () => {
    const document = pair();
    document.nets = [{ id: "A", terminals: [] }];
    document.junctions = [
      { id: "J1", netId: "A", position: { x: 150, y: 0 } },
      { id: "J2", netId: "A", position: { x: 150, y: 200 } },
    ];
    document.routes = [
      createRoutePath({
        id: "wire",
        netId: "A",
        start: { kind: "junction", junctionId: "J1" },
        end: { kind: "junction", junctionId: "J2" },
        bends: [],
        modes: ["auto"],
      }),
    ];
    expect(
      clearance(document).crossings([
        { x: 120, y: 100 },
        { x: 180, y: 100 },
      ]),
    ).toEqual([{ routeId: "wire", net: "A", point: { x: 150, y: 100 } }]);
  });
});

describe("a path beside its own Net's wires", () => {
  const p = (x: number, y: number) => ({ x, y });
  // An earlier branch of the Net: down x = 100 from y = 0 to y = 200.
  const branch = [p(100, 0), p(100, 200)] as const;

  it("ends at the first joined wire it would cross, a tap", () => {
    expect(
      meetOwnNet(
        [p(0, 100), p(200, 100), p(200, 300)],
        { joins: [branch] },
        10,
      ),
    ).toEqual({ points: [p(0, 100), p(100, 100)], tapped: true });
  });

  it("ends where it would start to run along a joined wire", () => {
    expect(
      meetOwnNet(
        [p(0, 300), p(100, 300), p(100, 100)],
        { joins: [branch] },
        10,
      ),
    ).toEqual({ points: [p(0, 300), p(100, 300), p(100, 200)], tapped: true });
  });

  it("is kept whole when it meets the joined wire only at its end", () => {
    expect(
      meetOwnNet([p(0, 100), p(100, 100)], { joins: [branch] }, 10),
    ).toEqual({ points: [p(0, 100), p(100, 100)], tapped: false });
  });

  it("leaves a tap where three wires already meet, as a four-way dot would", () => {
    // The branch ends on a trunk along y = 200: a path up x = 100 from
    // below would end at that T and make it a cross.
    expect(
      meetOwnNet(
        [p(100, 300), p(100, 100), p(300, 100)],
        { joins: [branch], trunk: [p(0, 200), p(300, 200)] },
        10,
      ),
    ).toBe(
      "meets its own Net's wire at (100, 200), where 3 wires already meet",
    );
  });

  it("refuses to cross, touch or run along a wire of its Net not yet joined", () => {
    expect(meetOwnNet([p(0, 100), p(200, 100)], { apart: [branch] }, 10)).toBe(
      "meets its own Net's wire at (100, 100), which it does not join, between (0, 100) and (200, 100)",
    );
    expect(
      meetOwnNet([p(100, 300), p(100, 100)], { apart: [branch] }, 10),
    ).toBe("runs along its own Net's wire between (100, 300) and (100, 100)");
    // Its own pin's wire may leave where the path starts.
    expect(meetOwnNet([p(100, 0), p(300, 0)], { apart: [branch] }, 10)).toEqual(
      { points: [p(100, 0), p(300, 0)], tapped: false },
    );
  });

  it("refuses to run along a joined wire from its start or to tap it off the grid", () => {
    expect(
      meetOwnNet(
        [p(100, 50), p(100, 150), p(200, 150)],
        { joins: [branch] },
        10,
      ),
    ).toBe("runs along its own Net's wire from (100, 50)");
    expect(meetOwnNet([p(0, 105), p(200, 105)], { joins: [branch] }, 10)).toBe(
      "meets its own Net's wire off the grid at (100, 105)",
    );
  });

  it("names the pins when every path would meet its Net's wire unjoined", () => {
    // R1.2 (20, 0) and R2.1 (380, 0); a wire of their Net not yet joined
    // stands between them, taller than any detour reaches.
    const document = createEmptyDocument("doc", "Wall");
    document.instances = [0, 400].map((x, index) => ({
      id: `R${index + 1}`,
      reference: `R${index + 1}`,
      symbolId: "resistor",
      placement: { position: { x, y: 0 }, rotation: 270, mirror: "none" },
    }));
    const found = clearance(document).path(
      { kind: "terminal", instanceId: "R1", pinName: "2" },
      { kind: "terminal", instanceId: "R2", pinName: "1" },
      { own: { apart: [[p(200, -1000), p(200, 1000)]] } },
    );
    expect(found).toMatch(
      /^no clear path from R1\.2 to R2\.1: the direct one meets its own Net's wire at \(200, /u,
    );
  });
});
