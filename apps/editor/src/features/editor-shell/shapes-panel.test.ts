import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  componentCatalog,
  paletteSymbols,
} from "../component-insert/symbol-catalog";
import { quickPlaceRequest, ShapesPanel } from "./shapes-panel";

describe("shapes quick-place", () => {
  it("exposes every palette device in the left Library", () => {
    const symbols = paletteSymbols("razavi");
    const groups = componentCatalog("razavi", "");
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

    expect(
      groups.map((group) => [group.category, group.symbols.length]),
    ).toEqual([
      ["Transistors", 4],
      ["Analog Blocks", 2],
      ["Passives", 4],
      ["Sources", 2],
      ["Switches", 2],
      ["Power and Ports", 4],
    ]);
    const categoryTestIds = [
      "transistors",
      "analog-blocks",
      "passives",
      "sources",
      "switches",
      "power-and-ports",
    ];
    for (let index = 0; index < categoryTestIds.length; index += 1) {
      const testId = `data-testid="shapes-category-${categoryTestIds[index]}"`;
      expect(markup).toContain(testId);
      if (index > 0) {
        expect(markup.indexOf(testId)).toBeGreaterThan(
          markup.indexOf(
            `data-testid="shapes-category-${categoryTestIds[index - 1]}"`,
          ),
        );
      }
    }
    expect(markup.match(/class="shapes-category" open=""/g)).toHaveLength(6);
    expect(markup.match(/class="shapes-category-header"/g)).toHaveLength(6);
    expect(markup).toContain('aria-label="Place Independent Voltage Source"');
    expect(markup).toContain(">V Src</span>");
    expect(markup).toContain(">Cap</span>");
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
