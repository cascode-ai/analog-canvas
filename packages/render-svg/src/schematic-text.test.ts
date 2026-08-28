import { describe, expect, it } from "vitest";
import { semanticTextDocument } from "@icm/model";

import { schematicTextFontSize } from "./schematic-text.js";
import { renderRichTextDocument } from "./rich-text.js";
import { razaviTextbookProfile } from "@icm/derived";

describe("Razavi schematic typography", () => {
  it("renders only the RichText AST supplied by its caller", () => {
    const fontSize = schematicTextFontSize(
      "power-label",
      razaviTextbookProfile,
    );
    const rendered = renderRichTextDocument(
      semanticTextDocument("VDD", "power-label"),
      razaviTextbookProfile,
      { fontSize },
    );
    expect(rendered).toContain('data-text-run="subscript"');
    expect(rendered).toContain(
      `font-size="${Number((fontSize * 0.76).toFixed(6))}px"`,
    );
    expect(rendered).not.toContain("baseline-shift");
    expect(rendered).not.toContain('font-size="76%"');
    expect(rendered).toContain("font-style:italic;font-weight:700");
    // Supply designators are the one italic subscript in the house style.
    expect(rendered).toContain(
      '<tspan data-text-run="span" style="font-style:italic;font-weight:700">DD</tspan>',
    );
  });

  it("draws an ordinary subscript upright", () => {
    const rendered = renderRichTextDocument(
      semanticTextDocument("Vin", "net-label"),
      razaviTextbookProfile,
      {
        fontSize: schematicTextFontSize("net-label", razaviTextbookProfile),
      },
    );
    expect(rendered).toContain(
      '<tspan data-text-run="span" style="font-style:normal;font-weight:700">in</tspan>',
    );
  });

  it("uses semantic profile sizes", () => {
    expect(schematicTextFontSize("instance-label", razaviTextbookProfile)).toBe(
      15.116,
    );
    expect(schematicTextFontSize("route-marker", razaviTextbookProfile)).toBe(
      15.116,
    );
  });
});
