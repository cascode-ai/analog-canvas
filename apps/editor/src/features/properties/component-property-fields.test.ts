import { describe, expect, it } from "vitest";
import { colorToRgb } from "./component-property-fields";

describe("inherited property colors", () => {
  it.each([
    ["#000", [0, 0, 0]],
    ["#fff", [255, 255, 255]],
    ["#aBc", [170, 187, 204]],
    ["#dc2626", [220, 38, 38]],
  ])("resolves %s to finite RGB channels", (color, channels) => {
    expect(colorToRgb(color)).toEqual(channels);
  });
});
