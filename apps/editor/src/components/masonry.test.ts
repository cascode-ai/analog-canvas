import { describe, expect, it } from "vitest";

import {
  createFrameCoalescer,
  masonryColumnCount,
  shortestColumn,
} from "./masonry";

describe("masonryColumnCount", () => {
  it("fits as many min-width columns as the container allows", () => {
    // 1236px container, 250px min columns, 14px gaps → 4 columns.
    expect(masonryColumnCount(1236, 250, 14)).toBe(4);
    expect(masonryColumnCount(514, 250, 14)).toBe(2);
    expect(masonryColumnCount(500, 250, 14)).toBe(1);
  });

  it("never drops below one column", () => {
    expect(masonryColumnCount(120, 250, 14)).toBe(1);
    expect(masonryColumnCount(0, 250, 14)).toBe(1);
  });
});

describe("shortestColumn", () => {
  it("targets the shortest column", () => {
    expect(shortestColumn([300, 120, 260])).toBe(1);
  });

  it("prefers the leftmost column on (near-)ties for reading order", () => {
    expect(shortestColumn([0, 0, 0])).toBe(0);
    expect(shortestColumn([200, 200.2, 199.8])).toBe(0);
  });

  it("fills an empty row left to right before stacking", () => {
    const heights = [0, 0, 0];
    const placed: number[] = [];
    for (const tileHeight of [120, 180, 150, 90]) {
      const column = shortestColumn(heights);
      placed.push(column);
      heights[column]! += tileHeight + 14;
    }
    // Three tiles fill the top row in order; the fourth lands under the
    // shortest (the first, 120-tall) column.
    expect(placed).toEqual([0, 1, 2, 0]);
  });
});

describe("createFrameCoalescer", () => {
  it("runs one layout for a burst and cancels queued work on cleanup", () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    let layouts = 0;
    const coalescer = createFrameCoalescer(
      () => {
        layouts += 1;
      },
      (callback) => {
        nextFrame += 1;
        frames.set(nextFrame, callback);
        return nextFrame;
      },
      (handle) => {
        frames.delete(handle);
      },
    );

    coalescer.schedule();
    coalescer.schedule();
    coalescer.schedule();
    expect(frames.size).toBe(1);
    frames.get(1)!(0);
    expect(layouts).toBe(1);

    coalescer.schedule();
    expect(frames.has(2)).toBe(true);
    coalescer.cancel();
    expect(frames.has(2)).toBe(false);
  });
});
