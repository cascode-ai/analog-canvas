import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";

import { renderInstanceOutlineGeometry } from "./render.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function documentWithTwoResistors() {
  const document = createEmptyDocument("doc-1", "Test");
  document.instances.push(
    {
      id: "inst-1",
      symbolId: "resistor",
      placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
      netlist: { reference: "R1", parameters: {} },
    },
    {
      id: "inst-2",
      symbolId: "resistor",
      placement: { position: { x: 300, y: 100 }, rotation: 90, mirror: "none" },
      netlist: { reference: "R2", parameters: {} },
    },
  );
  return document;
}

describe("renderInstanceOutlineGeometry", () => {
  it("emits artwork for the named instances only", () => {
    const markup = renderInstanceOutlineGeometry(
      documentWithTwoResistors(),
      resolver,
      ["inst-1"],
    );
    expect(markup).toContain('data-object-id="inst-1"');
    expect(markup).not.toContain('data-object-id="inst-2"');
  });

  it("places the outline on the instance, orientation included", () => {
    const markup = renderInstanceOutlineGeometry(
      documentWithTwoResistors(),
      resolver,
      ["inst-2"],
    );
    expect(markup).toContain('transform="translate(300 100) rotate(90)"');
  });

  /**
   * The halo exists so that marking a component does not repaint it. If the
   * outline carried the instance's own colour the layer beneath would tint
   * the mark to whatever the person chose, and the mark would vanish
   * entirely on a component coloured like the accent.
   */
  it("carries no colour of the instance's own", () => {
    const document = documentWithTwoResistors();
    document.instances[0]!.styleOverride = { foreground: "#FF0000" };
    const markup = renderInstanceOutlineGeometry(document, resolver, [
      "inst-1",
    ]);
    expect(markup).not.toContain("#FF0000");
  });

  it("traces artwork only, never text", () => {
    const markup = renderInstanceOutlineGeometry(
      documentWithTwoResistors(),
      resolver,
      ["inst-1", "inst-2"],
    );
    expect(markup).not.toContain("<text");
  });

  it("skips an instance that is not placed", () => {
    const document = documentWithTwoResistors();
    document.instances[1]!.placement = null;
    expect(
      renderInstanceOutlineGeometry(document, resolver, ["inst-1", "inst-2"]),
    ).not.toContain('data-object-id="inst-2"');
  });

  it("is empty when nothing is named", () => {
    expect(
      renderInstanceOutlineGeometry(documentWithTwoResistors(), resolver, []),
    ).toBe("");
  });
});
