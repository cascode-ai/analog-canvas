import { describe, expect, it } from "vitest";
import { equalJsonKeyOrder, equalJsonValue } from "./json-equal.js";

describe("json-equal", () => {
  it("compares nested JSON values ignoring key order and undefined properties", () => {
    expect(
      equalJsonValue(
        { a: 1, b: [true, { x: "hi", y: undefined }], z: undefined },
        { b: [true, { x: "hi" }], a: 1 },
      ),
    ).toBe(true);
    expect(equalJsonValue({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    expect(equalJsonValue({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(equalJsonValue([1, 2], { 0: 1, 1: 2 })).toBe(false);
    expect(equalJsonValue(0, -0)).toBe(true);
    expect(equalJsonValue(null, undefined)).toBe(false);
    expect(equalJsonValue({ a: null }, { a: undefined })).toBe(false);
  });

  it("preserves key order in equalJsonKeyOrder while skipping undefined properties", () => {
    expect(
      equalJsonKeyOrder(
        { a: 1, skip: undefined, b: { c: 2, d: 3 } },
        { a: 1, b: { c: 2, skip2: undefined, d: 3 } },
      ),
    ).toBe(true);
    expect(equalJsonKeyOrder({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(false);
    expect(equalJsonKeyOrder([1, 2], [1, 3])).toBe(false);
  });
});
