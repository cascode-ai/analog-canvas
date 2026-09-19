import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "@icm/model";

import { cellSymbolLayoutEditAtLocalPoint } from "./use-cell-symbol-layout";
import { localBlockSymbolTarget } from "./block-symbol-layout-target";

const layout = {
  body: { left: -40, right: 40, top: -30, bottom: 30 },
};

describe("cell symbol layout session", () => {
  it("snaps body resize intent to the symbol grid", () => {
    expect(
      cellSymbolLayoutEditAtLocalPoint(
        layout,
        { kind: "body" },
        { x: 47, y: 34 },
      ),
    ).toEqual({ kind: "body", width: 100, height: 60 });
  });

  it("snaps a dragged pin to the nearest unoccupied explicit slot", () => {
    const child = createEmptyDocument("child", "Child");
    child.presentation.cellSymbol = {
      pinPlacements: [
        { terminalId: "other", side: "west", offset: 20 },
        { terminalId: "another", side: "west", offset: 30 },
      ],
    };
    expect(
      cellSymbolLayoutEditAtLocalPoint(
        { ...layout, target: localBlockSymbolTarget(child) },
        { kind: "pin", terminalId: "moving" },
        { x: -40, y: 20 },
      ),
    ).toEqual({ kind: "pin", terminalId: "moving", side: "west", offset: 10 });
  });

  it("does not grow the body again when dragged across its centre", () => {
    expect(
      cellSymbolLayoutEditAtLocalPoint(
        layout,
        { kind: "body" },
        { x: -90, y: -90 },
      ),
    ).toEqual({ kind: "body", width: 20, height: 20 });
  });

  it("chooses the nearest pin side and snaps its signed offset", () => {
    expect(
      cellSymbolLayoutEditAtLocalPoint(
        layout,
        { kind: "pin", terminalId: "terminal-in" },
        { x: -38, y: 17 },
      ),
    ).toEqual({
      kind: "pin",
      terminalId: "terminal-in",
      side: "west",
      offset: 20,
    });
  });
});
