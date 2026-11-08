import { describe, expect, it } from "vitest";
import { simulationEntryVisible } from "./public-simulation-ui";

describe("Simulate entry (#2074)", () => {
  it("offers hosted simulation only to a team account", () => {
    expect(
      simulationEntryVisible({
        requested: true,
        transport: "managed",
        teamAccount: false,
      }),
    ).toBe(false);
    expect(
      simulationEntryVisible({
        requested: true,
        transport: "managed",
        teamAccount: true,
      }),
    ).toBe(true);
  });

  it("keeps a direct executor's entry, and never shows an unrequested one", () => {
    expect(
      simulationEntryVisible({
        requested: true,
        transport: "direct",
        teamAccount: false,
      }),
    ).toBe(true);
    expect(
      simulationEntryVisible({
        requested: false,
        transport: "managed",
        teamAccount: true,
      }),
    ).toBe(false);
  });
});
