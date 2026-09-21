import { describe, expect, it } from "vitest";
import {
  identifierTextDocument,
  richTextIdentifier,
  rewriteRichTextIdentifier,
  identifierSubscriptCase,
  richTextPresentsIdentifier,
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
  it("weight, slant and superscript do not change electrical spelling", () => {
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
    for (const style of ["bold", "italic", "superscript"] as const)
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

describe("overbar identifier convention", () => {
  it.each(["F_bar", "F_in_bar", "F_bar_bar"])(
    "round trips %s through an overbar without displaying the marker",
    (name) => {
      const text = identifierTextDocument(name);
      expect(text.runs[0]).toMatchObject({ kind: "span", style: "overbar" });
      expect(richTextIdentifier(text)).toBe(name);
      expect(flattenRichText(text)).toBe(
        name.slice(0, -4).replace(/(?<=.)_(?=.)/u, ""),
      );
      expect(richTextPresentsIdentifier(text, name)).toBe(true);
    },
  );

  it("adds one suffix for nested or partial bars and ignores empty bars", () => {
    expect(
      richTextIdentifier({
        runs: [
          {
            kind: "span",
            style: "overbar",
            children: [
              {
                kind: "span",
                style: "overbar",
                children: [{ kind: "text", value: "F" }],
              },
            ],
          },
          {
            kind: "span",
            style: "subscript",
            children: [{ kind: "text", value: "in" }],
          },
        ],
      }),
    ).toBe("F_in_bar");
    expect(
      richTextIdentifier({
        runs: [
          { kind: "text", value: "F" },
          { kind: "span", style: "overbar", children: [] },
        ],
      }),
    ).toBe("F");
  });

  it("adds and removes the bar on rename while retaining independent typography", () => {
    for (const source of [
      identifierTextDocument("F_in"),
      { runs: [{ kind: "text" as const, value: "F" }] },
    ]) {
      const barred = rewriteRichTextIdentifier(source, "F_out_bar");
      expect(richTextIdentifier(barred)).toBe("F_out_bar");
      expect(barred.runs[0]).toMatchObject({ kind: "span", style: "overbar" });
      expect(flattenRichText(barred)).toBe("Fout");
      expect(JSON.stringify(barred).includes('"italic"')).toBe(
        JSON.stringify(source).includes('"italic"'),
      );
      const renamed = rewriteRichTextIdentifier(barred, "Q_out_bar");
      expect(richTextIdentifier(renamed)).toBe("Q_out_bar");
      expect(renamed.runs[0]).toMatchObject({ kind: "span", style: "overbar" });
      const plain = rewriteRichTextIdentifier(renamed, "Q_out");
      expect(richTextIdentifier(plain)).toBe("Q_out");
      expect(JSON.stringify(plain)).not.toContain('"overbar"');
    }
  });

  it("preserves authored partial bars and keeps the reserved marker lowercase", () => {
    const source = {
      runs: [
        {
          kind: "span" as const,
          style: "overbar" as const,
          children: [{ kind: "text" as const, value: "F" }],
        },
        {
          kind: "span" as const,
          style: "subscript" as const,
          children: [{ kind: "text" as const, value: "in" }],
        },
      ],
    };
    const renamed = rewriteRichTextIdentifier(source, "F_out_bar");
    expect(richTextIdentifier(renamed)).toBe("F_out_bar");
    expect(renamed.runs[0]).toMatchObject({
      style: "overbar",
      children: [{ value: "F" }],
    });
    expect(renamed.runs[1]).toMatchObject({
      style: "subscript",
      children: [{ value: "out" }],
    });
    expect(identifierSubscriptCase("F_in_bar", "uppercase")).toBe("F_IN_bar");
    expect(identifierSubscriptCase("F_IN_bar", "lowercase")).toBe("F_in_bar");
    expect(identifierSubscriptCase("F_bar", "uppercase")).toBe("F_bar");
  });
});
