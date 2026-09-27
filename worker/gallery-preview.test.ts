import { describe, expect, it } from "vitest";

import { formulaPreviewNeedsRefresh } from "./gallery-preview";

describe("formula preview refresh", () => {
  it("redraws pending and superseded formula artwork once", () => {
    expect(
      formulaPreviewNeedsRefresh(
        '<svg><text data-role="formula-pending">V_{in}</text></svg>',
      ),
    ).toBe(true);
    expect(
      formulaPreviewNeedsRefresh(
        '<svg><svg overflow="visible" data-role="formula" data-formula-typography="sans-v2"></svg></svg>',
      ),
    ).toBe(true);
    expect(
      formulaPreviewNeedsRefresh(
        '<svg><svg overflow="visible" data-role="formula"></svg></svg>',
      ),
    ).toBe(true);
    // Label type drawn before its current run placement.
    expect(
      formulaPreviewNeedsRefresh(
        '<svg><g data-role="formula" data-formula-typography="label-v2"><text>V</text></g></svg>',
      ),
    ).toBe(true);
  });

  it("keeps current formula artwork and previews without formulas", () => {
    expect(
      formulaPreviewNeedsRefresh(
        '<svg><g data-role="formula" data-formula-typography="label-v3"><text>V</text></g></svg>',
      ),
    ).toBe(false);
    expect(
      formulaPreviewNeedsRefresh(
        '<svg><svg overflow="visible" data-role="formula" data-formula-typography="sans-v3"></svg></svg>',
      ),
    ).toBe(false);
    expect(formulaPreviewNeedsRefresh("<svg><text>R1</text></svg>")).toBe(
      false,
    );
  });
});
