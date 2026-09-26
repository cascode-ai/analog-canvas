import { describe, expect, it, vi } from "vitest";
import { createPointerPreviewFrame } from "./pointer-preview-frame";

function harness() {
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  const publish = vi.fn();
  const frame = createPointerPreviewFrame<number>(
    publish,
    (callback) => {
      frames.set(++id, callback);
      return id;
    },
    (id) => {
      frames.delete(id);
    },
  );
  return {
    frame,
    frames,
    publish,
    tick() {
      for (const [id, callback] of [...frames]) {
        frames.delete(id);
        callback(0);
      }
    },
  };
}

describe("pointer preview frame", () => {
  it("publishes only the newest pointer sample per frame", () => {
    const h = harness();
    for (let i = 0; i < 100; i++) h.frame.schedule(i);
    expect(h.frames.size).toBe(1);
    expect(h.publish).not.toHaveBeenCalled();
    h.tick();
    expect(h.publish.mock.calls).toEqual([[99]]);
    h.frame.schedule(100);
    h.tick();
    expect(h.publish.mock.calls).toEqual([[99], [100]]);
  });
  it("flushes the latest endpoint for keyboard completion without a later replay", () => {
    const h = harness();
    h.frame.schedule(1);
    h.frame.schedule(2);
    h.frame.flush();
    h.tick();
    expect(h.publish.mock.calls).toEqual([[2]]);
  });
  it("discards pending hover on click, leave or session replacement", () => {
    const h = harness();
    h.frame.schedule(1);
    h.frame.cancel();
    h.tick();
    expect(h.publish).not.toHaveBeenCalled();
    h.frame.schedule(2);
    h.tick();
    expect(h.publish.mock.calls).toEqual([[2]]);
  });
});
