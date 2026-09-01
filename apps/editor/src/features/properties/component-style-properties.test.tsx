import { createEmptyDocument } from "@icm/model";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  ComponentStyleProperties,
  hexToRgb,
  rgbToHex,
} from "./component-style-properties";

describe("component style properties", () => {
  it("renders accessible presets, RGB controls, and independent resets", () => {
    const document = createEmptyDocument("cell", "Cell");
    const instance: (typeof document.instances)[number] = {
      id: "R1",
      symbolId: "resistor",
      placement: {
        position: { x: 10, y: 20 },
        rotation: 0,
        mirror: "none",
      },
      styleOverride: {
        foreground: "#dc2626",
        background: "#ffffff",
      },
    };
    const markup = renderToStaticMarkup(
      <ComponentStyleProperties
        instance={instance}
        defaultForeground="#000000"
        onChange={vi.fn()}
      />,
    );

    expect(markup).toContain("Appearance");
    expect(markup).toContain('aria-label="Line / foreground custom RGB"');
    expect(markup).toContain('aria-label="Background / fill color picker"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("Gray · #6b7280");
    expect(markup).not.toContain("Violet");
    expect(markup).toContain("Colors apply to this component only.");
  });

  it("converts custom RGB values to canonical six-digit hex", () => {
    expect(rgbToHex({ r: 12, g: 128, b: 255 })).toBe("#0c80ff");
    expect(rgbToHex({ r: -10, g: 128.4, b: 999 })).toBe("#0080ff");
    expect(hexToRgb("#0c80ff")).toEqual({ r: 12, g: 128, b: 255 });
    expect(hexToRgb("#abc")).toEqual({ r: 170, g: 187, b: 204 });
  });
});
