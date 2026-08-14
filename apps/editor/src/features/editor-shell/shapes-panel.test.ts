import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { paletteSymbols } from "../component-insert/symbol-catalog";
import { quickPlaceRequest, ShapesPanel } from "./shapes-panel";

describe("shapes quick-place", () => {
  it("exposes every palette device in the left Library", () => {
    const symbols = paletteSymbols("razavi");
    const markup = renderToStaticMarkup(
      createElement(ShapesPanel, {
        styleProfileId: "razavi",
        recentSymbolIds: [],
        open: true,
        onOpenInsert: () => undefined,
        onQuickPlace: () => undefined,
      }),
    );

    expect(symbols).toHaveLength(18);
    expect(markup).toContain("All devices");
    expect(markup.match(/data-testid="shapes-chip-/g)).toHaveLength(
      symbols.length,
    );
    for (const symbol of symbols) {
      expect(markup).toContain(`data-testid="shapes-chip-${symbol.id}"`);
    }

    const priorityIds = [
      "resistor",
      "capacitor",
      "nmos",
      "pmos",
      "voltage-source",
      "ground",
      "vdd",
      "opamp",
    ];
    for (let index = 1; index < priorityIds.length; index += 1) {
      expect(
        markup.indexOf(`data-testid="shapes-chip-${priorityIds[index]}"`),
      ).toBeGreaterThan(
        markup.indexOf(`data-testid="shapes-chip-${priorityIds[index - 1]}"`),
      );
    }
    expect(markup).toContain('aria-label="Place Independent Voltage Source"');
    expect(markup).toContain(">Voltage Source</span>");
  });

  it("quick-places without persisting parameter placeholders", () => {
    const request = quickPlaceRequest("razavi", "resistor");
    expect(request).toMatchObject({
      kind: "symbol",
      symbolId: "resistor",
      symbolName: "Resistor",
      initialRotation: 0,
      showReference: true,
      referenceText: null,
    });
    expect(request?.kind === "symbol" ? request.properties.value : null).toBe(
      "",
    );
  });

  it("exposes VDD rail as a virtual Library placement", () => {
    expect(quickPlaceRequest("razavi", "vdd")).toEqual({
      kind: "vdd-rail",
      symbolId: "vdd",
      symbolName: "VDD Rail",
    });
  });

  it("returns null for unknown symbols", () => {
    expect(quickPlaceRequest("razavi", "not-a-symbol")).toBeNull();
  });
});
