import { describe, expect, it } from "vitest";

import { resolvePublicAgentUiEnabled } from "./public-agent-ui";

describe("resolvePublicAgentUiEnabled", () => {
  it("keeps local development available but makes production human-only", () => {
    expect(resolvePublicAgentUiEnabled({ production: false })).toBe(true);
    expect(resolvePublicAgentUiEnabled({ production: true })).toBe(false);
  });

  it("allows an explicit staging or local override", () => {
    expect(
      resolvePublicAgentUiEnabled({ production: true, configured: "enabled" }),
    ).toBe(true);
    expect(
      resolvePublicAgentUiEnabled({
        production: false,
        configured: "disabled",
      }),
    ).toBe(false);
  });
});
