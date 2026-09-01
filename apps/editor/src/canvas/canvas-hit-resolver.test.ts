import { describe, expect, it } from "vitest";

import { resolveCanvasHit, screenScaleHitRadius } from "./canvas-hit-resolver";

function element(kind: string, id: string, selected = false): Element {
  const classes = new Set(selected ? ["selected"] : []);
  return {
    getAttribute(name: string) {
      if (name === "data-canvas-hit-kind") return kind;
      if (name === "data-canvas-hit-id") return id;
      return null;
    },
    classList: { contains: (name: string) => classes.has(name) },
  } as unknown as Element;
}

describe("resolveCanvasHit", () => {
  it("prefers electrical geometry over incidental text in ordinary selection", () => {
    const route = element("route", "wire-1");
    const annotation = element("annotation", "label-1");
    expect(resolveCanvasHit([route, annotation])).toMatchObject({
      kind: "route",
      id: "wire-1",
    });
    expect(resolveCanvasHit([route, annotation], 1)).toMatchObject({
      kind: "annotation",
      id: "label-1",
    });
  });

  it("keeps an already-selected candidate sticky without masking real text", () => {
    const label = element("instance-label", "label-1");
    const instance = element("instance", "M1", true);
    expect(resolveCanvasHit([label, instance])).toMatchObject({
      kind: "instance",
      id: "M1",
    });
    expect(
      resolveCanvasHit([element("annotation", "label-2"), instance], 1),
    ).toMatchObject({ kind: "annotation", id: "label-2" });

    const route = element("route", "route-1", true);
    expect(
      resolveCanvasHit([element("annotation", "net-label"), route]),
    ).toMatchObject({ kind: "route", id: "route-1" });
    expect(
      resolveCanvasHit([element("annotation", "net-label"), route], 1),
    ).toMatchObject({ kind: "annotation", id: "net-label" });
  });

  it("deduplicates multiple painted parts of one object", () => {
    const first = element("drafting", "arrow-1");
    const second = element("drafting", "arrow-1");
    expect(resolveCanvasHit([first, second])).toMatchObject({
      kind: "drafting",
      id: "arrow-1",
      element: first,
    });
  });

  it("lets a deliberate click on visible wire beat the symbol bounding box", () => {
    // A route hit means the pointer is on the wire's thin stroke; an instance
    // hit only means it is inside the symbol's blank bounding box. The thin
    // target wins in either paint order.
    const route = element("route", "route-1");
    const instance = element("instance", "M1");
    expect(resolveCanvasHit([instance, route])).toMatchObject({
      kind: "route",
      id: "route-1",
    });
    expect(resolveCanvasHit([route, instance])).toMatchObject({
      kind: "route",
      id: "route-1",
    });
  });

  it("lets a junction dot beat the symbol bounding box the same way", () => {
    const junction = element("junction", "J1");
    const instance = element("instance", "M1");
    expect(resolveCanvasHit([instance, junction])).toMatchObject({
      kind: "junction",
      id: "J1",
    });
  });

  it("keeps the symbol selectable beside wires and sticky while selected", () => {
    // Away from any wire the instance is the only candidate.
    const aloneInstance = element("instance", "M1");
    expect(resolveCanvasHit([aloneInstance])).toMatchObject({
      kind: "instance",
      id: "M1",
    });
    // Under a wire the second click still cycles to the symbol.
    const route = element("route", "route-1");
    const instance = element("instance", "M1");
    expect(resolveCanvasHit([instance, route], 1)).toMatchObject({
      kind: "instance",
      id: "M1",
    });
    // An already-selected symbol stays sticky across crossing wires, so a
    // drag that starts over a wire pixel keeps moving the symbol.
    const selectedInstance = element("instance", "M1", true);
    expect(resolveCanvasHit([selectedInstance, route])).toMatchObject({
      kind: "instance",
      id: "M1",
    });
  });
});

describe("a hit radius that does not shrink when the view does", () => {
  it("keeps one screen size at every zoom", () => {
    // At 100% the radius is the pixel count; zoomed out two-fold the
    // document radius doubles so the circle looks the same on screen.
    expect(screenScaleHitRadius(1000, 1000, 6)).toBe(6);
    expect(screenScaleHitRadius(2000, 1000, 6)).toBe(12);
    expect(screenScaleHitRadius(500, 1000, 6)).toBe(3);
  });

  it("falls back to the pixel count when the view is not measurable yet", () => {
    expect(screenScaleHitRadius(0, 1000, 6)).toBe(6);
    expect(screenScaleHitRadius(1000, 0, 6)).toBe(6);
  });
});
