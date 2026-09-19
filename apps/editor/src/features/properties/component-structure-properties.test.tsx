import { createEmptyDocument } from "@icm/model";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CellSymbolLayoutProperties } from "./component-structure-properties";
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
  it("renders definition-level symbol layout controls", () => {
    const document = cell();
    document.netlist!.terminals.push({
      ...document.netlist!.terminals[0]!,
      id: "vin-copy",
      interfaceInstanceIds: ["P2"],
    });
    const markup = renderToStaticMarkup(
      <CellSymbolLayoutProperties
        target={localBlockSymbolTarget(document)}
        enabled
        onToggle={vi.fn()}
        onBodySizeChange={vi.fn()}
        onPortPlacementChange={vi.fn()}
      />,
    );

    expect(markup).toContain("Done editing canvas layout");
    expect(markup).toContain('aria-label="Cell symbol VIN pin side"');
    expect(markup.match(/aria-label="Cell symbol VIN pin side"/g)).toHaveLength(
      1,
    );
    expect(markup).toContain('<th scope="col">Side</th>');
    expect(markup).toContain('<th scope="row" title="VIN">VIN</th>');
    expect(markup).not.toContain("definition-level changes");
  });
});
