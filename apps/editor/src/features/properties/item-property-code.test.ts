import { describe, expect, it } from "vitest";
import { itemPropertyCode } from "./item-property-code";

describe("common item properties", () => {
  it("round trips specialized fields and prevents conflicting duplicate paths", () => {
    const native = JSON.stringify({
      placement: { at: [20, 30], rotation: 45 },
      appearance: { color: "auto", fillColor: [1, 2, 3] },
      geometry: { width: 80, height: 40 },
      locked: false,
    });
    const projection = itemPropertyCode(native, {
      type: "rectangle",
      name: "shape-1",
    });
    const value = JSON.parse(projection.format(native));
    expect(Object.keys(value).slice(0, 6)).toEqual([
      "type",
      "name",
      "coordinate",
      "rotation",
      "mirror",
      "color",
    ]);
    expect(JSON.parse(projection.restore(JSON.stringify(value)))).toEqual(
      JSON.parse(native),
    );
    value.coordinate = [40, 50];
    value.rotation = 90;
    expect(
      JSON.parse(projection.restore(JSON.stringify(value))).placement,
    ).toEqual({ at: [40, 50], rotation: 90 });
    value.placement = { at: [99, 99] };
    expect(() => projection.restore(JSON.stringify(value))).toThrow(
      "duplicates",
    );
    delete value.placement;
    value.mirror = "horizontal";
    expect(() => projection.restore(JSON.stringify(value))).toThrow(
      "not applicable",
    );
  });

  it("moves attached labels without detaching them or overwriting their text", () => {
    const native = JSON.stringify({
      placement: {
        anchor: {
          kind: "object",
          objectId: "R1",
          localOffset: { x: 10, y: -20 },
          fallbackPosition: { x: 110, y: 80 },
        },
        rotation: 0,
      },
      appearance: { color: "auto" },
      locked: false,
    });
    const projection = itemPropertyCode(native, {
      type: "instance-label",
      name: "R1",
      coordinate: [110, 80],
    });
    const value = JSON.parse(projection.format(native));
    value.coordinate = [150, 60];
    const restored = JSON.parse(projection.restore(JSON.stringify(value)));
    expect(restored.placement.anchor).toEqual({
      kind: "object",
      objectId: "R1",
      localOffset: { x: 50, y: -40 },
      fallbackPosition: { x: 150, y: 60 },
    });
    value.placement.anchor.localOffset.x = 12;
    expect(() => projection.restore(JSON.stringify(value))).toThrow(
      "one operation",
    );
  });

  it("keeps type immutable and exposes wire names without a duplicate net.name", () => {
    const native = JSON.stringify({
      net: { name: "OUT", scope: "local" },
      appearance: { color: "auto", lineStyle: "solid" },
    });
    const projection = itemPropertyCode(native, {
      type: "wire",
      name: "OUT",
      namePath: "net.name",
      coordinate: [100, 200],
    });
    const value = JSON.parse(projection.format(native));
    expect(value.net).toEqual({ scope: "local" });
    value.name = "IN";
    expect(JSON.parse(projection.restore(JSON.stringify(value))).net.name).toBe(
      "IN",
    );
    value.type = "resistor";
    expect(() => projection.restore(JSON.stringify(value))).toThrow(
      "type is read-only",
    );
  });
});
