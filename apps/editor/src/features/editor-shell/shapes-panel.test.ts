import { describe, expect, it } from "vitest";

import { STARTER_SYMBOL_IDS, quickPlaceRequest } from "./shapes-panel";

describe("shapes quick-place", () => {
  it("exposes starter chips with placement defaults", () => {
    expect(STARTER_SYMBOL_IDS).toContain("resistor");
    expect(STARTER_SYMBOL_IDS).toContain("nmos");

    const request = quickPlaceRequest("razavi", "resistor");
    expect(request).toMatchObject({
      symbolId: "resistor",
      symbolName: "Resistor",
      initialRotation: 0,
      showReference: true,
      referenceText: null,
    });
    expect(request?.properties.value).toBe("10k");
  });

  it("returns null for unknown symbols", () => {
    expect(quickPlaceRequest("razavi", "not-a-symbol")).toBeNull();
  });
});
