import { describe, expect, it } from "vitest";

import {
  createEmptyDocument,
  flattenRichText,
  formatLabelIdentifier,
  identifierTextDocument,
  labelTextDocument,
  richTextIdentifier,
  richTextPresentsIdentifier,
  roleLabelFormat,
  type RichTextDocument,
  type RichTextRun,
} from "./index.js";

/**
 * The names that once came out wrong somewhere between an authored name and
 * its look: a subscript nobody wrote, a split CLK, `_bar` in a subscript.
 * Each row says what every applicable formatter must draw for it; the
 * electrical spelling is the name itself throughout.
 */
const MATRIX = [
  // name, drawn without the separators, the subscript an `_` asks for, barred
  { name: "VIN", visible: "VIN", subscript: null, overbar: false },
  { name: "V_IN", visible: "VIN", subscript: "IN", overbar: false },
  { name: "CLK", visible: "CLK", subscript: null, overbar: false },
  { name: "RF", visible: "RF", subscript: null, overbar: false },
  { name: "M1", visible: "M1", subscript: null, overbar: false },
  { name: "R12_a", visible: "R12a", subscript: "a", overbar: false },
  { name: "Q_bar", visible: "Q", subscript: null, overbar: true },
] as const;

/** Text under each style, in order, e.g. { subscript: ["IN"] }. */
function styledText(document: RichTextDocument) {
  const found = { subscript: [] as string[], overbar: [] as string[] };
  const visit = (
    runs: readonly RichTextRun[],
    styles: ReadonlySet<string>,
  ): void => {
    for (const run of runs) {
      if (run.kind === "span")
        visit(run.children, new Set([...styles, run.style]));
      else if (run.kind === "text") {
        if (styles.has("subscript")) found.subscript.push(run.value);
        if (styles.has("overbar")) found.overbar.push(run.value);
      }
    }
  };
  visit(document.runs, new Set());
  return {
    subscript: found.subscript.join(""),
    overbar: found.overbar.join(""),
  };
}

const presentation = createEmptyDocument("doc", "Labels").presentation;

describe("label names across every formatter", () => {
  describe.each(MATRIX)("$name", (row) => {
    // The look a name gets without a standard role look: formal Ports and
    // Net labels whose name has none, free labels bound to a name, and the
    // drawing's own label typography.
    it.each([
      ["identifier", identifierTextDocument(row.name)],
      ["drawing label", labelTextDocument(row.name, presentation)],
    ])("%s look keeps the authored name", (_look, document) => {
      // 1 and 7: the exact characters and case, and the name back out.
      expect(flattenRichText(document)).toBe(row.visible);
      expect(richTextIdentifier(document)).toBe(row.name);
      expect(richTextPresentsIdentifier(document, row.name)).toBe(true);
      const styled = styledText(document);
      // 2 and 4: only an explicit `_` starts a subscript, and only its span.
      expect(styled.subscript).toBe(row.subscript ?? "");
      expect(styled.subscript).not.toContain("_");
      // 3 and 6: `_bar` is a bar over the whole name, never subscript text.
      expect(styled.overbar).toBe(row.overbar ? row.visible : "");
      expect(styled.subscript).not.toContain("bar");
      expect(flattenRichText(document)).not.toContain("bar");
    });

    it("explicit naming with the default settings never respells the name", () => {
      expect(
        formatLabelIdentifier(row.name, {
          subscriptAfterFirst: false,
          subscriptCase: "preserve",
        }),
      ).toBe(row.name);
    });
  });

  // A standard role look belongs to a name form, not to every name.
  const looks = (role: "supply" | "voltage-node") =>
    Object.fromEntries(
      MATRIX.map(({ name }) => [
        name,
        roleLabelFormat(role, name) && {
          visible: flattenRichText(roleLabelFormat(role, name)!),
          subscript: styledText(roleLabelFormat(role, name)!).subscript,
        },
      ]),
    );

  it.each(["supply", "voltage-node"] as const)(
    "a %s label gives only a V-led name the V-over-subscript look",
    (role) => {
      expect(looks(role)).toEqual({
        VIN: { visible: "VIN", subscript: "IN" },
        // 4: no first-character rule for anything else; these fall back to
        // the identifier look checked above.
        V_IN: undefined,
        CLK: undefined,
        RF: undefined,
        M1: undefined,
        R12_a: undefined,
        Q_bar: undefined,
      });
      // The look presents VIN; the electrical name keeps no underscore.
      const vin = roleLabelFormat(role, "VIN")!;
      expect(richTextPresentsIdentifier(vin, "VIN")).toBe(true);
    },
  );

  it("a device Reference splits at its own device letter or before its index, nowhere else", () => {
    const reference = (name: string, deviceLetter: string) => {
      const look = roleLabelFormat("device-reference", name, { deviceLetter });
      return (
        look && {
          visible: flattenRichText(look),
          subscript: styledText(look).subscript,
          presents: richTextPresentsIdentifier(look, name),
        }
      );
    };
    // 5: M1 is M over index 1; R12_a keeps its authored `_` split (checked
    // with the identifier look above), not a guessed R over 12_a.
    expect(reference("M1", "M")).toEqual({
      visible: "M1",
      subscript: "1",
      presents: true,
    });
    expect(reference("R12_a", "R")).toBeUndefined();
    // A resistor named RF is R_F, as a feedback resistor is written; a
    // subcircuit or a Net that happens to be named RF or CLK is not split.
    expect(reference("RF", "R")).toEqual({
      visible: "RF",
      subscript: "F",
      presents: true,
    });
    expect(reference("RF", "X")).toBeUndefined();
    expect(reference("CLK", "X")).toBeUndefined();
    // Q_bar as a Reference has no standard look; its bar is only styling.
    expect(reference("Q_bar", "Q")).toBeUndefined();
  });
});
