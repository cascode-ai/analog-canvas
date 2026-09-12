import { describe, expect, it } from "vitest";
import { colorToRgb, parseCanvasColor } from "./component-property-fields";

describe("property color picker transport", () => {
  it("expands inherited short hex colors before populating a native picker", () => {
    expect(colorToRgb("#0aF")).toEqual([0, 170, 255]);
    expect(parseCanvasColor(colorToRgb("#0aF"), "appearance.foreground")).toBe(
      "#00aaff",
    );
    expect(colorToRgb("#dc2626")).toEqual([220, 38, 38]);
  });
});
