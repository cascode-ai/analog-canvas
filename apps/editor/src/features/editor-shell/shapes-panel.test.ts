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
    const markup = renderToStaticMarkup(
      createElement(ShapesPanel, {
        styleProfileId: "razavi",
        open: true,
        onStartInsert: () => undefined,
      }),
    );
    expect(markup.match(/data-testid="shapes-chip-/g)).toHaveLength(
      symbols.length,
    );
    for (const symbol of symbols)
      expect(markup).toContain(`data-testid="shapes-chip-${symbol.id}"`);
    expect(
      componentCatalog("razavi", "").every((group) => group.symbols.length > 0),
    ).toBe(true);
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
      "1k",
    );
  });

  it("quick-places adjustable and compound passives with authored defaults", () => {
    for (const [symbolId, parameters] of [
      ["variable-resistor", { value: "1k" }],
      ["variable-capacitor", { value: "1p" }],
      ["variable-inductor", { value: "1n" }],
      ["tcoil", { l1: "1n", l2: "1n", k: "1", cb: "1p" }],
      ["xfmr", { lp: "1n", ls: "1n", k: "1" }],
    ] as const) {
      expect(quickPlaceRequest("razavi", symbolId)).toMatchObject({
        kind: "symbol",
        symbolId,
        parameters,
      });
    }
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
      ["annotation-polyline", "Polyline", "polyline"],
      ["annotation-rectangle", "Rectangle", "rectangle"],
      ["annotation-circle", "Circle", "circle"],
      ["annotation-arc", "Arc", "arc"],
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
    // A standalone sign is the same mark the pair draws, so it goes through
    // the same polarity placement; as a preset text glyph it came out a
    // different size beside the pair. The sign-with-text forms left the
    // palette entirely.
    expect(quickPlaceRequest("razavi", "annotation-text-plus")).toEqual({
      kind: "polarity-annotation",
      symbolId: "annotation-text-plus",
      symbolName: "Plus sign",
      polarity: "positive",
      initialRotation: 0,
    });
    expect(quickPlaceRequest("razavi", "annotation-text-minus")).toEqual({
      kind: "polarity-annotation",
      symbolId: "annotation-text-minus",
      symbolName: "Minus sign",
      polarity: "negative",
      initialRotation: 0,
    });
    expect(quickPlaceRequest("razavi", "annotation-ellipsis")).toEqual({
      kind: "drafting-text",
      symbolId: "annotation-ellipsis",
      symbolName: "Three dots",
      text: "...",
      initialRotation: 0,
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

  it("places the Cell Pin and Bias Voltage Port without a setup dialog", () => {
    expect(quickPlaceRequest("razavi", "port")).toMatchObject({
      kind: "symbol",
      symbolId: "port",
      portDirection: "passive",
      showReference: false,
    });
    expect(quickPlaceRequest("razavi", "port-filled")).toMatchObject({
      symbolId: "port-filled",
      symbolName: "Bias Voltage Port",
      portDirection: "passive",
    });
    expect(quickPlaceRequest("razavi", "cell-pin")).toBeNull();
  });
});
