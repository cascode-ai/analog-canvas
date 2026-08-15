import { describe, expect, it } from "vitest";

import { defaultDraftTextDocument } from "./semantic-text.js";

describe("defaultDraftTextDocument", () => {
  it("uses Razavi bold italic text and a bold upright subscript", () => {
    expect(defaultDraftTextDocument("V_out")).toEqual({
      runs: [
        {
          kind: "span",
          style: "italic",
          children: [
            {
              kind: "span",
              style: "bold",
              children: [{ kind: "text", value: "V" }],
            },
          ],
        },
        {
          kind: "span",
          style: "subscript",
          children: [
            {
              kind: "span",
              style: "bold",
              children: [{ kind: "text", value: "out" }],
            },
          ],
        },
      ],
    });
  });

  it("styles ordinary free text as a Razavi math base", () => {
    expect(defaultDraftTextDocument("Design note")).toEqual({
      runs: [
        {
          kind: "span",
          style: "italic",
          children: [
            {
              kind: "span",
              style: "bold",
              children: [{ kind: "text", value: "Design note" }],
            },
          ],
        },
      ],
    });
  });
});
