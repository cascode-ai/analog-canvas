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
});
