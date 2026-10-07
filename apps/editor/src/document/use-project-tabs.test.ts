import { describe, expect, it } from "vitest";

import { tabAfterLeaving } from "./use-project-tabs";

describe("tabAfterLeaving", () => {
  it("hands over to the tab before the one that leaves", () => {
    expect(tabAfterLeaving(["a", "b", "c"], "c")).toBe("b");
    expect(tabAfterLeaving(["a", "b", "c"], "b")).toBe("a");
  });

  it("hands the first tab's place to the next one", () => {
    expect(tabAfterLeaving(["a", "b", "c"], "a")).toBe("b");
  });

  it("leaves no tab when the last one goes", () => {
    expect(tabAfterLeaving(["a"], "a")).toBeUndefined();
  });

  it("passes over the other tabs closing with it", () => {
    const closing = new Set(["b", "c", "d"]);
    expect(tabAfterLeaving(["a", "b", "c", "d", "e"], "c", closing)).toBe("a");
    expect(tabAfterLeaving(["b", "c", "d", "e"], "c", closing)).toBe("e");
    expect(tabAfterLeaving(["b", "c", "d"], "c", closing)).toBeUndefined();
  });
});
