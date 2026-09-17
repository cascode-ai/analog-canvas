import { afterEach, describe, expect, it, vi } from "vitest";
import { deferFocus } from "./deferred-focus";

afterEach(() => vi.unstubAllGlobals());

function harness() {
  const events = new EventTarget();
  const frames = new Map<number, FrameRequestCallback>();
  let next = 0;
  Object.assign(events, {
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      frames.set(++next, callback);
      return next;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  });
  vi.stubGlobal("window", events);
  const target = {
    isConnected: true,
    getClientRects: () => [{}],
    focus: vi.fn(),
  };
  const flush = () => {
    for (const [id, callback] of [...frames]) {
      frames.delete(id);
      callback(0);
    }
  };
  return { events, target, flush, get: () => target as unknown as HTMLElement };
}

describe("deferred user focus", () => {
  it("honors a fresh explicit request exactly once without scrolling", () => {
    const h = harness();
    deferFocus(h.get);
    h.flush();
    h.flush();
    expect(h.target.focus).toHaveBeenCalledExactlyOnceWith({
      preventScroll: true,
    });
  });

  it.each(["pointerdown", "keydown", "focusin"])(
    "yields to a newer %s interaction",
    (event) => {
      const h = harness();
      deferFocus(h.get);
      h.events.dispatchEvent(new Event(event));
      h.flush();
      expect(h.target.focus).not.toHaveBeenCalled();
    },
  );

  it("cancels on cleanup and ignores detached or hidden destinations", () => {
    const h = harness();
    const cancel = deferFocus(h.get);
    cancel();
    h.flush();
    h.target.isConnected = false;
    deferFocus(h.get);
    h.flush();
    h.target.isConnected = true;
    h.target.getClientRects = () => [];
    deferFocus(h.get);
    h.flush();
    expect(h.target.focus).not.toHaveBeenCalled();
  });
});
