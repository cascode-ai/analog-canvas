import { describe, expect, it } from "vitest";

import { resolvePublicUiFeatureEnabled } from "./public-ui-feature";

describe("resolvePublicUiFeatureEnabled", () => {
  it("fails closed for production and stays available in development", () => {
    expect(resolvePublicUiFeatureEnabled({ production: true })).toBe(false);
    expect(resolvePublicUiFeatureEnabled({ production: false })).toBe(true);
  });

  it("honors an explicit channel build choice", () => {
    expect(
      resolvePublicUiFeatureEnabled({
        production: true,
        configured: "enabled",
      }),
    ).toBe(true);
    expect(
      resolvePublicUiFeatureEnabled({
        production: false,
        configured: "disabled",
      }),
    ).toBe(false);
  });

  it("does not treat an unknown value as an opt-in", () => {
    expect(
      resolvePublicUiFeatureEnabled({
        production: true,
        configured: "yes",
      }),
    ).toBe(false);
  });
});
