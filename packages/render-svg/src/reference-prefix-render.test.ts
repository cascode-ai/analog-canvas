import { createEmptyDocument } from "@icm/model";
import type { SchematicDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { renderDocumentSvg } from "./render.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function conductanceSheet(prefixHidden: boolean): SchematicDocument {
  const document = createEmptyDocument("doc", "Conductance");
  document.instances.push({
    id: "inst-1",
    symbolId: "resistor",
    placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
    reference: "RG1",
    netlist: { parameters: { value: "1k" } },
  });
  document.annotations.push({
    id: "label-1",
    kind: "instance-label",
    binding: { kind: "instance-reference", instanceId: "inst-1" },
    anchor: {
      kind: "object",
      objectId: "inst-1",
      localOffset: { x: 0, y: -20 },
      fallbackPosition: { x: 100, y: 80 },
    },
    alignment: "middle",
    rotation: 0,
    locked: false,
    ...(prefixHidden ? { referencePrefixHidden: true } : {}),
  });
  return document;
}

describe("reference prefix rendering", () => {
  it("draws the whole Reference by default", () => {
    const svg = renderDocumentSvg(conductanceSheet(false), resolver);
    expect(svg).toContain(">R<");
    expect(svg).toContain(">G1<");
  });

  it("drops the device prefix from the drawn Reference when it is hidden", () => {
    const svg = renderDocumentSvg(conductanceSheet(true), resolver);
    // `RG1` is painted as the conductance `G1`: symbol `G` with subscript `1`.
    expect(svg).toContain(">G<");
    expect(svg).toContain(">1<");
    expect(svg).not.toContain(">RG1<");
    expect(svg).not.toContain(">R<");
  });
});
