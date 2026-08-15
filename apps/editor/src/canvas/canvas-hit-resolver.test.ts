import { describe, expect, it } from "vitest";

import { resolveCanvasHit } from "./canvas-hit-resolver";

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
});
