import { describe, expect, it } from "vitest";
import { semanticTextDocument, voltageNodeTextDocument } from "@icm/model";

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

  it("draws an explicitly authored subscript upright", () => {
    const rendered = renderRichTextDocument(
      {
        runs: [
          { kind: "text", value: "V" },
          {
            kind: "span",
            style: "subscript",
            children: [
              {
                kind: "span",
                style: "bold",
                children: [{ kind: "text", value: "in" }],
              },
            ],
          },
        ],
      },
      razaviTextbookProfile,
      {
        fontSize: schematicTextFontSize("net-label", razaviTextbookProfile),
      },
    );
    expect(rendered).toContain(
      '<tspan data-text-run="span" style="font-style:normal;font-weight:700">in</tspan>',
    );
  });

  it("lowercases only the visual suffix of a generated voltage name", () => {
    const rendered = renderRichTextDocument(
      voltageNodeTextDocument("VB12"),
      razaviTextbookProfile,
    );

    expect(rendered).toContain('data-text-run="subscript"');
    expect(rendered).toContain(">b12</tspan>");
    expect(rendered).not.toContain(">B12</tspan>");
  });

  it("uppercases only the visual head of a lowercase voltage name", () => {
    const rendered = renderRichTextDocument(
      voltageNodeTextDocument("vBIAS"),
      razaviTextbookProfile,
    );

    expect(rendered).toContain(">V</tspan>");
    expect(rendered).toContain(">bias</tspan>");
    expect(rendered).not.toContain(">v</tspan>");
  });

  it("keeps a default Net Label bold italic without an implicit subscript", () => {
    const rendered = renderRichTextDocument(
      semanticTextDocument("Vin", "net-label"),
      razaviTextbookProfile,
      {
        fontSize: schematicTextFontSize("net-label", razaviTextbookProfile),
      },
    );
    expect(rendered).toContain(
      '<tspan data-text-run="span" style="font-style:italic;font-weight:700">Vin</tspan>',
    );
    expect(rendered).not.toContain('data-text-run="subscript"');
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
