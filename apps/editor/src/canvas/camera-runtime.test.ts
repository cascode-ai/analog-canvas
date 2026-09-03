import { describe, expect, it, vi } from "vitest";

import { createCameraRuntime } from "./camera-runtime";

function fixture() {
  const frames: FrameRequestCallback[] = [];
  const commits: Array<() => void> = [];
  const committed = vi.fn();
  const attributes = new Map<string, string>();
  const boundedAttributes = new Map<string, string>();
  const getBoundingClientRect = vi.fn(() => ({
    x: 10,
    y: 20,
    left: 10,
    top: 20,
    right: 1010,
    bottom: 820,
    width: 1000,
    height: 800,
    toJSON: () => ({}),
  })) as unknown as SVGSVGElement["getBoundingClientRect"];
  const surface = {
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    getBoundingClientRect,
    querySelectorAll: () => [
      {
        setAttribute: (name: string, value: string) =>
          boundedAttributes.set(name, value),
      },
    ],
  } as unknown as SVGSVGElement;
  const runtime = createCameraRuntime(
    { x: 0, y: 0, width: 1000, height: 800 },
    committed,
    {
      requestFrame: (callback) => (frames.push(callback), frames.length),
      cancelFrame: vi.fn(),
      scheduleCommit: (callback) => (commits.push(callback), commits.length),
      cancelCommit: vi.fn(),
    },
  );
  runtime.attach(surface);
  return {
    runtime,
    surface,
    frames,
    commits,
    committed,
    attributes,
    boundedAttributes,
    getBoundingClientRect,
  };
}

describe("camera runtime", () => {
  it("coalesces hardware events into one animation frame and one settled commit", () => {
    const {
      runtime,
      frames,
      commits,
      committed,
      attributes,
      boundedAttributes,
    } = fixture();

    runtime.schedule((current) => ({ ...current, x: current.x + 10 }), 10);
    runtime.schedule((current) => ({ ...current, x: current.x + 15 }), 10);

    expect(frames).toHaveLength(1);
    expect(committed).not.toHaveBeenCalled();
    frames[0]!(0);
    expect(attributes.get("viewBox")).toBe("25 0 1000 800");
    expect(boundedAttributes.get("x")).toBe("25");
    commits.at(-1)!();
    expect(committed).toHaveBeenCalledTimes(1);
    expect(committed).toHaveBeenLastCalledWith({
      x: 25,
      y: 0,
      width: 1000,
      height: 800,
    });
  });

  it("flushes the latest pointer position before the gesture ends", () => {
    const { runtime, committed, attributes } = fixture();
    runtime.schedule({ x: 31, y: 42, width: 900, height: 700 }, 10);
    runtime.flush();
    expect(attributes.get("viewBox")).toBe("31 42 900 700");
    expect(committed).toHaveBeenCalledOnce();
  });

  it("caches layout bounds until an observed layout change invalidates them", () => {
    const { runtime, surface, getBoundingClientRect } = fixture();
    runtime.measureSurface(surface);
    runtime.measureSurface(surface);
    expect(getBoundingClientRect).toHaveBeenCalledTimes(1);
    runtime.invalidateSurfaceBounds();
    runtime.measureSurface(surface);
    expect(getBoundingClientRect).toHaveBeenCalledTimes(2);
  });
});
