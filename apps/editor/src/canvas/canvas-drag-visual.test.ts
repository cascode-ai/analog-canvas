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
});
