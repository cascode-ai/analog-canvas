import { describe, expect, it } from "vitest";
import {
  identifierTextDocument,
  richTextIdentifier,
  rewriteRichTextIdentifier,
  identifierSubscriptCase,
} from "./identifier-text.js";
import { flattenRichText } from "./rich-text.js";

describe("electrical identifier presentation", () => {
  it.each(["M1", "M_1", "V_in", "v_In_cm", "VDD", "V_SS", "A__b"])(
    "round trips %s without guessing a name",
    (name) => {
      const text = identifierTextDocument(name);
      expect(richTextIdentifier(text)).toBe(name);
      expect(JSON.stringify(text).includes('"subscript"')).toBe(
        name.includes("_"),
      );
      expect(JSON.stringify(text)).toContain('"bold"');
      expect(JSON.stringify(text)).toContain('"italic"');
    },
  );
  it("scripts are the only typography that changes electrical spelling", () => {
    const content = {
      runs: [
        { kind: "text" as const, value: "M" },
        {
          kind: "span" as const,
          style: "subscript" as const,
          children: [{ kind: "text" as const, value: "load" }],
        },
      ],
    };
    expect(richTextIdentifier(content)).toBe("M_load");
    for (const style of ["bold", "italic", "superscript", "overbar"] as const)
      expect(
        richTextIdentifier({
          runs: [{ kind: "span", style, children: content.runs }],
        }),
      ).toBe("M_load");
  });
  it("renames both ways while retaining explicit normal and bold italic", () => {
    const normal = { runs: [{ kind: "text" as const, value: "M1" }] };
    expect(
      richTextIdentifier(rewriteRichTextIdentifier(normal, "M_load")),
    ).toBe("M_load");
    expect(
      JSON.stringify(rewriteRichTextIdentifier(normal, "M_load")),
    ).not.toMatch(/bold|italic/);
    const italic = rewriteRichTextIdentifier(
      identifierTextDocument("M1"),
      "M_load",
    );
    expect(flattenRichText(italic)).toBe("Mload");
    expect(richTextIdentifier(italic)).toBe("M_load");
    expect(JSON.stringify(italic)).toContain('"italic"');
    const plain = rewriteRichTextIdentifier(italic, "M2");
    expect(richTextIdentifier(plain)).toBe("M2");
    expect(JSON.stringify(plain)).not.toContain('"subscript"');
    expect(identifierSubscriptCase("myMos_LoAd", "lowercase")).toBe(
      "myMos_load",
    );
  });
});
