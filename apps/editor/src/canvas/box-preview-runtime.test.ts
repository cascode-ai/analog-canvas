import { describe, expect, it } from "vitest";
import { createBoxPreviewRuntime } from "./box-preview-runtime";
import type { BoxPreview } from "./canvas-gesture-model";

function fixture() {
  const frames = new Map<number, FrameRequestCallback>();
  const attributes = new Map<string, string>();
  const writes: Array<[string, string]> = [];
  let id = 0;
  // Clock and browser DOM are external ports; all runtime/geometry is real.
  const surface = {
    querySelector: () => ({
      setAttribute(name: string, value: string) {
        attributes.set(name, value);
        writes.push([name, value]);
      },
    }),
  } as unknown as SVGSVGElement;
  const runtime = createBoxPreviewRuntime(
    (callback) => (frames.set(++id, callback), id),
    (id) => {
      frames.delete(id);
    },
  );
  const initial: BoxPreview = {
    start: { x: 100, y: 100 },
    end: { x: 100, y: 100 },
    pointerId: 1,
    intent: "select",
  };
  runtime.replace(initial);
  runtime.attach(surface);
  writes.length = 0;
  const tick = () => {
    for (const [id, callback] of [...frames]) {
      frames.delete(id);
      callback(0);
    }
  };
  return { runtime, surface, initial, frames, attributes, writes, tick };
}

describe("marquee preview runtime", () => {
  it("retains latest raw coordinates immediately and paints once per frame", () => {
    const f = fixture();
    for (let i = 0; i < 100; i++)
      f.runtime.preview({ ...f.initial, end: { x: 90.5, y: 70.25 } });
    expect(f.runtime.current()?.end).toEqual({ x: 90.5, y: 70.25 });
    expect(f.frames.size).toBe(1);
    expect(f.writes).toEqual([]);
    f.tick();
    expect(Object.fromEntries(f.attributes)).toEqual({
      x: "90.5",
      y: "70.25",
      width: "9.5",
      height: "29.75",
      class: "selection-box selection-box--crossing",
    });
    expect(f.writes).toHaveLength(5);
    f.runtime.flush();
    expect(f.writes).toHaveLength(5);
  });
  it("drops queued paint on reset and ignores samples from a replaced gesture", () => {
    const f = fixture();
    f.runtime.preview({ ...f.initial, end: { x: 400, y: 300 } });
    f.runtime.replace(null);
    f.tick();
    expect(f.runtime.current()).toBeNull();
    expect(f.writes).toEqual([]);
    f.runtime.replace({ ...f.initial, pointerId: 2 });
    f.runtime.preview({ ...f.initial, end: { x: 400, y: 300 } });
    f.tick();
    expect(f.runtime.current()?.end).toEqual({ x: 100, y: 100 });
    expect(f.writes).toEqual([]);
  });
  it("retires the gesture on detach and never paints it into a new surface", () => {
    const f = fixture();
    f.runtime.preview({ ...f.initial, end: { x: 400, y: 300 } });
    f.runtime.detach(f.surface);
    f.tick();
    f.runtime.attach(f.surface);
    expect(f.runtime.current()).toBeNull();
    expect(f.writes).toEqual([]);
  });
});
