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
        open: true,
        onStartInsert: () => undefined,
      }),
    );

    expect(symbols).toHaveLength(46);
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
      ["Passives", 8],
      ["Power and Ports", 5],
      ["Sources", 2],
      ["Switches", 2],
      ["Analog Blocks", 6],
      ["Logic Gates", 10],
      ["Annotations", 7],
      ["Extended Devices", 2],
    ]);
    const categoryTestIds = [
      "transistors",
      "passives",
      "power-and-ports",
      "sources",
      "switches",
      "analog-blocks",
      "logic-gates",
      "annotations",
      "extended-devices",
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
    expect(markup.match(/class="shapes-category" open=""/g)).toHaveLength(9);
    expect(markup.match(/class="shapes-category-header"/g)).toHaveLength(9);
    expect(markup).toContain('aria-label="Place Independent Voltage Source"');
    expect(markup).not.toContain('aria-label="Place Pulse Voltage Source"');
    expect(markup).toContain('title="Place Capacitor"');
    expect(markup).toContain('aria-label="Place Variable Resistor"');
    expect(markup).toContain('aria-label="Place Inverter"');
    expect(markup).toContain('aria-label="Place Buffer"');
    expect(markup).toContain('aria-label="Place Delay Cell"');
    expect(markup).toContain('aria-label="Place D Flip-Flop"');
    expect(markup).toContain('aria-label="Place Comparator"');
    expect(markup).toContain('aria-label="Place Comparator (unmarked)"');
    expect(markup).toContain('aria-label="Place N-channel DMOS"');
    expect(markup).toContain('aria-label="Place P-channel DMOS"');
    expect(markup).toContain(
      '<div class="shapes-subcategory-label">High-voltage devices</div>',
    );
    expect(markup).toContain(">V Src</span>");
    expect(markup).toContain(">Cap</span>");
    expect(markup).toContain(">Var Res</span>");
    expect(markup).toContain(">Inv</span>");
    expect(markup).toContain(">Comp U</span>");
    expect(markup).toContain(">NOR</span>");
    expect(markup).not.toContain('data-testid="shapes-example-');
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
    expect(request?.kind === "symbol" ? request.parameters.value : null).toBe(
      "",
    );
  });

  it("exposes VDD rail as a virtual Library placement", () => {
    expect(quickPlaceRequest("razavi", "vdd")).toEqual({
      kind: "vdd-rail",
      symbolId: "vdd",
      symbolName: "Power Rail",
      netName: "VDD",
    });
  });

  it("starts annotation drawing tools and polarity-label placement", () => {
    for (const [symbolId, symbolName, tool] of [
      ["annotation-arrow", "Arrow", "arrow"],
      ["annotation-line", "Line", "construction-line"],
      ["annotation-rectangle", "Rectangle", "rectangle"],
      ["annotation-circle", "Circle", "circle"],
    ] as const) {
      expect(quickPlaceRequest("razavi", symbolId)).toEqual({
        kind: "drawing-tool",
        symbolId,
        symbolName,
        tool,
      });
    }
    expect(quickPlaceRequest("razavi", "annotation-polarity-both")).toEqual({
      kind: "polarity-annotation",
      symbolId: "annotation-polarity-both",
      symbolName: "Polarity (+ / text / −)",
      polarity: "both",
      initialRotation: 0,
    });
    // Standalone signs are preset texts, not polarity variants; the single
    // sign-with-text forms left the palette entirely.
    expect(quickPlaceRequest("razavi", "annotation-text-plus")).toEqual({
      kind: "preset-text",
      symbolId: "annotation-text-plus",
      symbolName: "Plus sign",
      text: "+",
    });
    expect(quickPlaceRequest("razavi", "annotation-text-minus")).toEqual({
      kind: "preset-text",
      symbolId: "annotation-text-minus",
      symbolName: "Minus sign",
      text: "−",
    });
    expect(quickPlaceRequest("razavi", "annotation-polarity-positive")).toBe(
      null,
    );
    expect(quickPlaceRequest("razavi", "annotation-polarity-negative")).toBe(
      null,
    );
  });

  it("quick-places high-voltage DMOS with MOS parameters", () => {
    expect(quickPlaceRequest("razavi", "ndmos")).toMatchObject({
      kind: "symbol",
      symbolId: "ndmos",
      symbolName: "N-channel DMOS",
      parameters: { w: "1u", l: "150n", nf: "1", m: "1" },
    });
  });

  it("places both Cell Pin artworks without a setup dialog", () => {
    expect(quickPlaceRequest("razavi", "port")).toMatchObject({
      kind: "symbol",
      symbolId: "port",
      portDirection: "passive",
      showReference: false,
    });
    expect(quickPlaceRequest("razavi", "port-filled")).toMatchObject({
      symbolId: "port-filled",
      portDirection: "passive",
    });
    expect(quickPlaceRequest("razavi", "cell-pin")).toBeNull();
  });

  it("returns null for unknown symbols", () => {
    expect(quickPlaceRequest("razavi", "not-a-symbol")).toBeNull();
  });
});
