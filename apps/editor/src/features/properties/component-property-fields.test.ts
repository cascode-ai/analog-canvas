import { describe, expect, it } from "vitest";
import {
  CANVAS_PROPERTY_FIELDS,
  colorToRgb,
  parseCanvasColor,
} from "./component-property-fields";

describe("property color picker transport", () => {
  it("keeps default comments minimal without removing expanded help", () => {
    for (const path of ["placement.rotation", "placement.mirror"]) {
      const field = CANVAS_PROPERTY_FIELDS.find((item) => item.path === path)!;
      expect(field.description).toBe("");
      expect(field.help).toBeTruthy();
    }
    for (const path of ["appearance.foreground", "appearance.background"])
      expect(
        CANVAS_PROPERTY_FIELDS.find((item) => item.path === path)?.description,
      ).toBe("RGB visualization");
  });
  it("expands inherited short hex colors before populating a native picker", () => {
    expect(colorToRgb("#0aF")).toEqual([0, 170, 255]);
    expect(parseCanvasColor(colorToRgb("#0aF"), "appearance.foreground")).toBe(
      "#00aaff",
    );
    expect(colorToRgb("#dc2626")).toEqual([220, 38, 38]);
  });
});
