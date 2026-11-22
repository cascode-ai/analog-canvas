import { createEmptyDocument } from "@icm/model";
import { builtInSymbols } from "@icm/symbols";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { InstanceSymbolLayoutRow } from "./component-structure-properties";
import { localBlockSymbolTarget } from "../hierarchy/block-symbol-layout-target";

function cell() {
  const document = createEmptyDocument("cell", "Amplifier");
  document.netlist = {
    name: "Amplifier",
    terminals: [
      {
        id: "vin",
        name: "VIN",
        netId: "net-vin",
        direction: "input",
        interfaceInstanceIds: ["P1"],
      },
    ],
    formalParameters: [],
  };
  return document;
}

describe("component structure properties", () => {
  it("keeps only the on-canvas grips in a selected block's row", () => {
    const target = localBlockSymbolTarget(cell());
    const row = (enabled: boolean) =>
      renderToStaticMarkup(
        <InstanceSymbolLayoutRow
          target={target}
          instanceSymbolId={target.id}
          enabled={enabled}
          onToggle={vi.fn()}
        />,
      );

    expect(row(false)).toContain('aria-pressed="false"');
    expect(row(false)).toContain("Edit on canvas");
    expect(row(false)).not.toContain("Drag an edge");
    expect(row(true)).toContain('aria-pressed="true"');
    expect(row(true)).toContain("Drag an edge or corner to resize.");
    // Size, sides and offsets stay in the definition's sheet.
    expect(row(false)).not.toContain("Cell symbol width");
    expect(row(false)).not.toContain("pin side");
  });

  it("offers no grips for custom artwork", () => {
    const document = cell();
    // Present artwork means Custom, whatever it draws.
    document.presentation.cellSymbol = {
      artwork: { symbol: builtInSymbols[0]!, terminals: [] },
    };
    const target = localBlockSymbolTarget(document);
    expect(
      renderToStaticMarkup(
        <InstanceSymbolLayoutRow
          target={target}
          instanceSymbolId={target.id}
          enabled={false}
          onToggle={vi.fn()}
        />,
      ),
    ).toBe("");
  });
});
