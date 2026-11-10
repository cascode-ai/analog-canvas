import { createEmptyDocument, flattenRichText } from "@icm/model";
import { describe, expect, it } from "vitest";
import { placedNetLabelDraft, prepareNetLabelDraft } from "./net-label-draft";

const presentation = createEmptyDocument("labels", "Labels").presentation;
const typed = (value: string) => ({ runs: [{ kind: "text" as const, value }] });

describe("Net Label drafts", () => {
  it("places the name applied, not the name its look spells (#2206)", () => {
    const applied = prepareNetLabelDraft(typed("BIAS_REF"), presentation);
    expect(applied.name).toBe("BIAS_REF");
    // The applied look draws REF as a subscript and hides the `_`.
    expect(flattenRichText(applied.content)).toBe("BIASREF");

    const placed = placedNetLabelDraft(
      { content: applied.content, applied },
      presentation,
    );

    expect(placed).toEqual(applied);
  });

  it("prepares a draft whose look changed after it was applied", () => {
    const applied = prepareNetLabelDraft(typed("BIAS_REF"), presentation);

    const placed = placedNetLabelDraft(
      { content: typed("BAD_NET"), applied },
      presentation,
    );

    expect(placed.name).toBe("BAD_NET");
  });

  it("prepares a draft never applied", () => {
    expect(
      placedNetLabelDraft({ content: typed("BAD_NET") }, presentation).name,
    ).toBe("BAD_NET");
  });
});
