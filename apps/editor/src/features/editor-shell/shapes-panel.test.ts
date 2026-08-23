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

    expect(symbols).toHaveLength(34);
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
      ["Power and Ports", 6],
      ["Sources", 2],
      ["Switches", 2],
      ["Analog Blocks", 5],
      ["Logic Gates", 7],
    ]);
    const categoryTestIds = [
      "transistors",
      "passives",
      "power-and-ports",
      "sources",
      "switches",
      "analog-blocks",
      "logic-gates",
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
    expect(markup.match(/class="shapes-category" open=""/g)).toHaveLength(7);
    expect(markup.match(/class="shapes-category-header"/g)).toHaveLength(7);
    expect(markup).toContain('aria-label="Place Independent Voltage Source"');
    expect(markup).toContain('title="Place Capacitor"');
    expect(markup).toContain('aria-label="Place Variable Resistor"');
    expect(markup).toContain('aria-label="Place Inverter"');
    expect(markup).toContain('aria-label="Place Comparator"');
    expect(markup).toContain(">V Src</span>");
    expect(markup).toContain(">Cap</span>");
    expect(markup).toContain(">Var Res</span>");
    expect(markup).toContain(">Inv</span>");
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

  it("places both Port roles without a setup dialog", () => {
    // ADR 0034 keeps the role explicit: the Library entry carries it, and the
    // generated name is edited on the canvas afterwards.
    expect(quickPlaceRequest("razavi", "port")).toMatchObject({
      kind: "symbol",
      symbolId: "port",
      portRole: "net-port",
      showReference: false,
    });
    expect(quickPlaceRequest("razavi", "port-filled")).toMatchObject({
      symbolId: "port-filled",
      portRole: "net-port",
    });
    expect(quickPlaceRequest("razavi", "cell-pin")).toMatchObject({
      kind: "symbol",
      symbolId: "port",
      symbolName: "Interface Pin",
      portRole: "cell-terminal",
      portDirection: "passive",
    });
  });

  it("returns null for unknown symbols", () => {
    expect(quickPlaceRequest("razavi", "not-a-symbol")).toBeNull();
  });
});
