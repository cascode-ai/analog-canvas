import { createEmptyDocument, createRoutePath } from "@icm/model";
import type { Instance, SchematicDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  describePlacementNearMiss,
  findPlacementNearMisses,
} from "./placement-near-miss";

const resolver = new InMemorySymbolResolver(builtInSymbols);

/**
 * One horizontal wire at y = 300, running x = 200..400, on a 10-unit grid.
 * A resistor's pins sit 20 above and below its position.
 */
function documentWithWire(): SchematicDocument {
  const document = createEmptyDocument("near-miss", "Near miss");
  document.presentation.grid = 10;
  document.nets.push({ id: "net-vdd", terminals: [] });
  document.junctions.push(
    { id: "J1", netId: "net-vdd", position: { x: 200, y: 300 } },
    { id: "J2", netId: "net-vdd", position: { x: 400, y: 300 } },
  );
  document.routes.push(
    createRoutePath({
      id: "w1",
      netId: "net-vdd",
      start: { kind: "junction", junctionId: "J1" },
      end: { kind: "junction", junctionId: "J2" },
      bends: [],
      modes: ["manual"],
    }),
  );
  return document;
}

/** Resistor pin 1 sits 20 above the body centre, pin 2 sits 20 below. */
function resistorAt(x: number, y: number): Instance {
  return {
    id: "R3",
    symbolId: "resistor",
    placement: { position: { x, y }, rotation: 0, mirror: "none" },
  } as Instance;
}

describe("placement near misses", () => {
  it("reports a pin one grid short of a wire", () => {
    const document = documentWithWire();
    // Pin 1 lands at y = 310 — one grid below the wire at 300.
    const misses = findPlacementNearMisses(
      document,
      resolver,
      resistorAt(300, 330),
    );
    expect(misses).toEqual([
      { pinName: "1", netId: "net-vdd", netLabel: "a wire", gridsAway: 1 },
    ]);
    expect(describePlacementNearMiss(misses, "R3")).toBe(
      "R3 pin 1 is 1 grid from a wire — not connected",
    );
  });

  it("says nothing when the part is simply somewhere else", () => {
    const document = documentWithWire();
    const misses = findPlacementNearMisses(
      document,
      resolver,
      resistorAt(300, 500),
    );
    expect(misses).toEqual([]);
    expect(describePlacementNearMiss(misses, "R3")).toBeNull();
  });

  it("says nothing when the pin is on the wire, because that connects", () => {
    const document = documentWithWire();
    // Pin 1 lands exactly on y = 300: contact, which placement already handles.
    const misses = findPlacementNearMisses(
      document,
      resolver,
      resistorAt(300, 320),
    );
    expect(misses.some((miss) => miss.pinName === "1")).toBe(false);
  });

  it("measures to the nearest drawn point, not the infinite line", () => {
    const document = documentWithWire();
    // Well beyond the wire's right end at x = 400, level with it. The
    // perpendicular distance to the line would be zero; to the segment it is
    // far, and a part out here has nothing to do with that wire.
    const misses = findPlacementNearMisses(
      document,
      resolver,
      resistorAt(900, 320),
    );
    expect(misses).toEqual([]);
  });

  it("ignores a pin resting off the grid, which is a different mistake", () => {
    const document = documentWithWire();
    // Pin 1 at y = 305 — half a square out, so "one grid short" is not what
    // happened and saying so would misdescribe it.
    const misses = findPlacementNearMisses(
      document,
      resolver,
      resistorAt(300, 325),
    );
    expect(misses).toEqual([]);
  });

  it("names the nearest wire when a pin is two grids out", () => {
    const document = documentWithWire();
    const misses = findPlacementNearMisses(
      document,
      resolver,
      resistorAt(300, 340),
    );
    expect(misses).toEqual([
      { pinName: "1", netId: "net-vdd", netLabel: "a wire", gridsAway: 2 },
    ]);
    expect(describePlacementNearMiss(misses, "R3")).toBe(
      "R3 pin 1 is 2 grids from a wire — not connected",
    );
  });

  it("says a named net's name rather than its generated id", () => {
    const document = documentWithWire();
    document.connectivityEvidence.push({
      id: "claim-vdd",
      kind: "name-claim",
      netId: "net-vdd",
      name: "VDD",
      scope: "global",
      owner: { kind: "explicit-net-property" },
    });
    const misses = findPlacementNearMisses(
      document,
      resolver,
      resistorAt(300, 330),
    );
    expect(misses[0]?.netLabel).toBe("VDD");
    expect(describePlacementNearMiss(misses, "R3")).toBe(
      "R3 pin 1 is 1 grid from VDD — not connected",
    );
  });

  it("stays quiet in a drawing with no wires at all", () => {
    const document = createEmptyDocument("bare", "Bare");
    document.presentation.grid = 10;
    expect(
      findPlacementNearMisses(document, resolver, resistorAt(300, 330)),
    ).toEqual([]);
  });

  it("never hints about a pin the symbol hides", () => {
    // A three-terminal NMOS hides its bulk pin B. At (280,310) against the
    // wire at y=300, hidden B (300,310) and visible G (260,310) and D
    // (290,290) are all exactly one grid away: the hint may name the pins a
    // person can see, and must not name the one they cannot.
    const document = documentWithWire();
    const mos = {
      id: "M9",
      symbolId: "nmos",
      symbolVariantId: "textbook-3terminal",
      placement: { position: { x: 280, y: 310 }, rotation: 0, mirror: "none" },
    } as Instance;
    const misses = findPlacementNearMisses(document, resolver, mos);
    const pinNames = misses.map((miss) => miss.pinName);
    expect(pinNames).toContain("G");
    expect(pinNames).toContain("D");
    expect(pinNames).not.toContain("B");
  });
});
