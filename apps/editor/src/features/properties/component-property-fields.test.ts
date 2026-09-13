import { describe, expect, it } from "vitest";
import {
  CANVAS_PROPERTY_FIELDS,
  colorToRgb,
  parseCanvasColor,
} from "./component-property-fields";

describe("property color picker transport", () => {
  it("names visual annotation explicitly while retaining validation guidance", () => {
    expect(
      CANVAS_PROPERTY_FIELDS.find(
        (field) => field.path === "display.visualAnnotation",
      )?.label,
    ).toBe("Visual annotation");
    expect(
      CANVAS_PROPERTY_FIELDS.find(
        (field) => field.path === "appearance.background",
      ),
    ).toBeUndefined();
    expect(
      CANVAS_PROPERTY_FIELDS.filter((field) => field.help).length,
    ).toBeGreaterThan(0);
  });
  it("expands inherited short hex colors before populating a native picker", () => {
    expect(colorToRgb("#0aF")).toEqual([0, 170, 255]);
    expect(parseCanvasColor(colorToRgb("#0aF"), "appearance.foreground")).toBe(
      "#00aaff",
    );
    expect(colorToRgb("#dc2626")).toEqual([220, 38, 38]);
  });
});
