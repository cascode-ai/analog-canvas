import { describe, expect, it } from "vitest";

import { buildSceneSafely } from "./scene-safety";

describe("buildSceneSafely", () => {
  it("falls back to the last good scene with the failure reason", () => {
    const outcome = buildSceneSafely(
      () => {
        throw new Error("bad geometry");
      },
      { id: 0 },
    );
    expect(outcome).toEqual({
      scene: { id: 0 },
      degraded: true,
      message: "bad geometry",
    });
  });

  it("rethrows when there is no last good scene to fall back to", () => {
    expect(() =>
      buildSceneSafely(() => {
        throw new Error("first render");
      }, null),
    ).toThrowError("first render");
  });

  it("reports non-Error throws with a generic message", () => {
    const outcome = buildSceneSafely(
      () => {
        throw "plain string";
      },
      { id: 0 },
    );
    expect(outcome.degraded).toBe(true);
    expect(outcome.message).toBe("scene build failed");
  });
});
