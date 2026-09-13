import { describe, expect, it } from "vitest";
import { fractionFromSelection } from "./fraction-selection";

describe("fraction selection", () => {
  it("keeps numerator and denominator formatting when converting one slash", () => {
    expect(
      fractionFromSelection({
        runs: [
          {
            kind: "span",
            style: "bold",
            children: [
              { kind: "text", value: "1/g" },
              {
                kind: "span",
                style: "subscript",
                children: [{ kind: "text", value: "mN" }],
              },
            ],
          },
        ],
      }),
    ).toEqual({
      kind: "fraction",
      numerator: {
        runs: [
          {
            kind: "span",
            style: "bold",
            children: [{ kind: "text", value: "1" }],
          },
        ],
      },
      denominator: {
        runs: [
          {
            kind: "span",
            style: "bold",
            children: [
              { kind: "text", value: "g" },
              {
                kind: "span",
                style: "subscript",
                children: [{ kind: "text", value: "mN" }],
              },
            ],
          },
        ],
      },
    });
  });
  it("uses a selection without an unambiguous slash as the numerator", () => {
    const selected = { runs: [{ kind: "text" as const, value: "a/b/c" }] };
    expect(fractionFromSelection(selected).numerator).toEqual(selected);
    expect(fractionFromSelection({ runs: [] })).toEqual({
      kind: "fraction",
      numerator: { runs: [{ kind: "text", value: "a" }] },
      denominator: { runs: [{ kind: "text", value: "b" }] },
    });
  });
});
