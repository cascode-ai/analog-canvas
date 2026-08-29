import { resolveDocumentStyleProfile } from "@icm/derived";
import { createEmptyDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EditorSelectionHalo } from "./editor-selection-halo";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function twoResistors() {
  const document = createEmptyDocument("cell", "Cell");
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
      placement: { position: { x: 300, y: 100 }, rotation: 0, mirror: "none" },
      netlist: { reference: "R2", parameters: {} },
    },
  );
  return document;
}

function render(
  selectedInstanceIds: readonly string[],
  wouldMoveIds: ReadonlySet<string> = new Set(),
) {
  const document = twoResistors();
  return renderToStaticMarkup(
    <EditorSelectionHalo
      document={document}
      resolver={resolver}
      styleProfile={resolveDocumentStyleProfile(document.presentation)}
      selectedInstanceIds={selectedInstanceIds}
      wouldMoveIds={wouldMoveIds}
    />,
  );
}

describe("editor selection halo", () => {
  it("traces the selected component rather than boxing it", () => {
    const markup = render(["inst-1"]);
    expect(markup).toContain('class="selection-halo"');
    expect(markup).toContain('data-object-id="inst-1"');
    expect(markup).not.toContain('data-object-id="inst-2"');
  });

  it("draws nothing at all when the selection holds no component", () => {
    expect(render([])).toBe("");
  });

  /**
   * Both bodies painting the same instance would stack their stroke alpha and
   * read as a third, brighter state that means nothing.
   */
  it("keeps a selected component out of the would-move body", () => {
    const markup = render(["inst-1"], new Set(["inst-1", "inst-2"]));
    const wouldMove = markup.slice(
      markup.indexOf("selection-halo-body--would-move"),
      markup.indexOf("selection-halo-body--selected"),
    );
    expect(wouldMove).toContain('data-object-id="inst-2"');
    expect(wouldMove).not.toContain('data-object-id="inst-1"');
  });

  it("ignores would-move members that are not components", () => {
    const markup = render([], new Set(["route-7", "junction-3"]));
    expect(markup).toBe("");
  });

  it("stays out of the way of every pointer gesture", () => {
    expect(render(["inst-1"])).toContain('aria-hidden="true"');
  });
});
