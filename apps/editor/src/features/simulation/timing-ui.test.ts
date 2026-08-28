import { describe, expect, it } from "vitest";

import { resolveTimingUiEnabled } from "./timing-ui";

describe("resolveTimingUiEnabled", () => {
  it("shows timing tools during local development and hides them in production", () => {
    expect(resolveTimingUiEnabled({ production: false })).toBe(true);
    expect(resolveTimingUiEnabled({ production: true })).toBe(false);
  });

  it("supports an explicit staging or local override", () => {
    expect(
      resolveTimingUiEnabled({ production: true, configured: "enabled" }),
    ).toBe(true);
    expect(
      resolveTimingUiEnabled({ production: false, configured: "disabled" }),
    ).toBe(false);
  });
});
