import { expect, it } from "vitest";
import { createEmptyDocument } from "./factories.js";
import { flattenRichText } from "./rich-text.js";
import {
  identifierTextDocument,
  richTextIdentifier,
  rewriteRichTextIdentifier,
  formatLabelSubscripts,
} from "./identifier-text.js";
import {
  formatLabelFirstLetter,
  formatLabelIdentifier,
  labelTypography,
  labelTextDocument,
} from "./label-typography.js";

it("gives new drawings italic initials and upright preserved-case subscripts", () => {
  const presentation = createEmptyDocument("a", "A").presentation;
  expect(labelTypography(presentation)).toEqual({
    underscoreSubscript: true,
    subscriptAfterFirst: true,
    subscriptCase: "preserve",
    subscriptItalic: false,
    firstLetterItalic: true,
  });
  expect(formatLabelIdentifier("VinP", labelTypography(presentation))).toBe(
    "V_inP",
  );
  const content = labelTextDocument("V_inP", presentation);
  expect(richTextIdentifier(content)).toBe("V_inP");
  expect(JSON.stringify(content.runs[0])).toContain('"italic"');
  expect(JSON.stringify(content.runs[1])).not.toContain('"italic"');
});

it("keeps the legacy typography fallback for saved drawings without explicit fields", () => {
  expect(
    labelTypography({
      styleProfileId: "razavi-textbook-v1",
      grid: 10,
      compactness: "normal",
    }),
  ).toEqual({
    underscoreSubscript: true,
    subscriptAfterFirst: false,
    subscriptCase: "preserve",
    subscriptItalic: true,
    firstLetterItalic: true,
  });
});

it("switches underscores between literal text and subscripts without changing the name", () => {
  const presentation = {
    ...createEmptyDocument("a", "A").presentation,
    labelSubscriptAfterFirst: false,
    labelSubscriptItalic: true,
  };
  for (const name of ["A_1", "V_in_cm", "Q_out_bar"]) {
    const scripted = labelTextDocument(name, presentation);
    const literal = labelTextDocument(name, {
      ...presentation,
      labelUnderscoreSubscript: false,
    });
    expect(richTextIdentifier(scripted)).toBe(name);
    expect(richTextIdentifier(literal)).toBe(name);
    expect(JSON.stringify(scripted)).toContain('"subscript"');
    expect(JSON.stringify(literal)).not.toContain('"subscript"');
    expect(flattenRichText(literal)).toBe(name.replace(/_bar$/, ""));
    expect(
      rewriteRichTextIdentifier(scripted, name, { underscoreSubscript: false }),
    ).toEqual(literal);
  }
});

it("uses an explicit naming action for first-letter subscripts and keeps bar markers", () => {
  const options = {
    subscriptAfterFirst: true,
    subscriptCase: "uppercase" as const,
  };
  expect(formatLabelIdentifier("Vin", options)).toBe("V_IN");
  expect(formatLabelIdentifier("V_in_bar", options)).toBe("V_IN_bar");
  expect(formatLabelIdentifier("A", options)).toBe("A");
  expect(formatLabelIdentifier("a long note", options)).toBe("a long note");
  expect(formatLabelIdentifier("1/s", options)).toBe("1/s");
});

it("changes initial slant without splitting one subscript into separate glyph groups", () => {
  const content = identifierTextDocument("A_load");
  const upright = formatLabelFirstLetter(content, false);
  expect(richTextIdentifier(upright)).toBe("A_load");
  expect(upright.runs[0]).toEqual({
    kind: "span",
    style: "bold",
    children: [{ kind: "text", value: "A" }],
  });
  expect(upright.runs[1]).toEqual(content.runs[1]);
  expect(formatLabelFirstLetter(upright, true).runs[1]).toEqual(
    content.runs[1],
  );
  expect(content).toEqual(identifierTextDocument("A_load"));
});

it("retains one continuous overbar across separately styled initial and subscript", () => {
  const text = formatLabelFirstLetter(
    identifierTextDocument("F_out_bar"),
    false,
  );
  expect(text.runs).toHaveLength(1);
  expect(text.runs[0]).toMatchObject({ kind: "span", style: "overbar" });
  expect(JSON.stringify(text).match(/"overbar"/g)).toHaveLength(1);
  expect(richTextIdentifier(text)).toBe("F_out_bar");
});

it("applies subscript case even beneath an older whole-label case style", () => {
  const text = formatLabelSubscripts(
    {
      runs: [
        {
          kind: "span",
          style: "uppercase",
          children: identifierTextDocument("v_LOAD").runs,
        },
      ],
    },
    { case: "lowercase" },
  );
  expect(flattenRichText(text)).toBe("Vload");
  expect(richTextIdentifier(text)).toBe("V_load");
  expect(JSON.stringify(text)).not.toContain('"uppercase"');
  expect(JSON.stringify(text)).toContain('"bold"');
});
