import { describe, expect, it } from "vitest";

import { startCanvasDragVisual } from "./canvas-drag-visual";

class FakeElement {
  readonly attributes = new Map<string, string>();

  constructor(entries: Record<string, string>) {
    Object.entries(entries).forEach(([name, value]) =>
      this.attributes.set(name, value),
    );
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
}

describe("startCanvasDragVisual", () => {
  it("moves a junction independently of its stretched incident wires and restores both", () => {
    const junction = new FakeElement({
      "data-object-id": "J",
      transform: "translate(10 20)",
    });
    const route = new FakeElement({
      "data-object-id": "R",
      points: "10,20 100,20",
    });
    const root = {
      querySelectorAll: () => [junction, route],
    } as unknown as ParentNode;
    const visual = startCanvasDragVisual(root, ["J", "R"]);
    visual.translateObject("J", { x: 0, y: -10 });
    visual.setObjectPolyline("R", [
      { x: 10, y: 10 },
      { x: 100, y: 10 },
    ]);
    expect(junction.getAttribute("transform")).toBe(
      "translate(0 -10) translate(10 20)",
    );
    expect(route.getAttribute("transform")).toBeNull();
    visual.restore();
    expect(junction.getAttribute("transform")).toBe("translate(10 20)");
    expect(route.getAttribute("points")).toBe("10,20 100,20");
  });
  it("composes translation with existing transforms and restores exactly", () => {
    const formal = new FakeElement({
      "data-object-id": "M1",
      transform: "rotate(90)",
    });
    const hit = new FakeElement({ "data-drag-object-id": "M1" });
    const root = {
      querySelectorAll: () => [formal, hit],
    } as unknown as ParentNode;
    const visual = startCanvasDragVisual(root, ["M1"]);
    visual.translate({ x: 12.5, y: -3 });
    expect(formal.getAttribute("transform")).toBe(
      "translate(12.5 -3) rotate(90)",
    );
    expect(hit.getAttribute("transform")).toBe("translate(12.5 -3)");
    visual.restore();
    expect(formal.getAttribute("transform")).toBe("rotate(90)");
    expect(hit.getAttribute("transform")).toBeNull();
  });

  it("previews and restores persisted polyline geometry", () => {
    const route = new FakeElement({
      "data-object-id": "route-1",
      points: "0,0 10,0",
    });
    const sibling = new FakeElement({
      "data-object-id": "route-2",
      points: "0,10 10,10",
    });
    const root = {
      querySelectorAll: () => [route, sibling],
    } as unknown as ParentNode;
    const visual = startCanvasDragVisual(root, ["route-1", "route-2"]);
    visual.setObjectPolyline("route-1", [
      { x: 0, y: 5 },
      { x: 10, y: 5 },
    ]);
    expect(route.getAttribute("points")).toBe("0,5 10,5");
    expect(sibling.getAttribute("points")).toBe("0,10 10,10");
    visual.restore();
    expect(route.getAttribute("points")).toBe("0,0 10,0");
    expect(sibling.getAttribute("points")).toBe("0,10 10,10");
  });

  it("previews a uniform group scale around its fixed pivot", () => {
    const trace = new FakeElement({
      "data-object-id": "waveform-trace",
      transform: "rotate(90)",
    });
    const hit = new FakeElement({
      "data-drag-object-id": "waveform-trace",
    });
    const root = {
      querySelectorAll: () => [trace, hit],
    } as unknown as ParentNode;
    const visual = startCanvasDragVisual(root, ["waveform-trace"]);

    visual.scale({ x: 20, y: 30 }, 1.5);

    expect(trace.getAttribute("transform")).toBe(
      "translate(20 30) scale(1.5) translate(-20 -30) rotate(90)",
    );
    expect(hit.getAttribute("transform")).toBe(
      "translate(20 30) scale(1.5) translate(-20 -30)",
    );
    visual.restore();
    expect(trace.getAttribute("transform")).toBe("rotate(90)");
    expect(hit.getAttribute("transform")).toBeNull();
  });

  it("stretches a label tether end by end with whichever of its objects moves", () => {
    const tether = () =>
      new FakeElement({
        "data-tether-label-id": "L",
        "data-tether-owner-id": "P",
        x1: "10",
        y1: "20",
        x2: "40",
        y2: "60",
      });
    const rootWith = (line: FakeElement) =>
      ({
        querySelectorAll: (selector: string) =>
          selector.includes("data-tether") ? [line] : [],
      }) as unknown as ParentNode;
    const ends = (line: FakeElement) =>
      ["x1", "y1", "x2", "y2"].map((name) => line.getAttribute(name));

    const labelOnly = tether();
    const dragLabel = startCanvasDragVisual(rootWith(labelOnly), ["L"]);
    dragLabel.translate({ x: 5, y: 7 });
    expect(ends(labelOnly)).toEqual(["15", "27", "40", "60"]);
    dragLabel.restore();
    expect(ends(labelOnly)).toEqual(["10", "20", "40", "60"]);

    const both = tether();
    startCanvasDragVisual(rootWith(both), ["L", "P"]).translate({
      x: 5,
      y: 7,
    });
    expect(ends(both)).toEqual(["15", "27", "45", "67"]);

    // A tether that renders after the drag began still stretches.
    let late: FakeElement[] = [];
    const lateRoot = {
      querySelectorAll: (selector: string) =>
        selector.includes("data-tether") ? late : [],
    } as unknown as ParentNode;
    const dragLate = startCanvasDragVisual(lateRoot, ["L"]);
    const appeared = tether();
    late = [appeared];
    dragLate.translate({ x: 5, y: 7 });
    expect(ends(appeared)).toEqual(["15", "27", "40", "60"]);
    dragLate.restore();
    expect(ends(appeared)).toEqual(["10", "20", "40", "60"]);

    const ownerOnly = tether();
    startCanvasDragVisual(rootWith(ownerOnly), ["L", "P"]).translateObject(
      "P",
      { x: -3, y: 2 },
    );
    expect(ends(ownerOnly)).toEqual(["10", "20", "37", "62"]);
  });
});
