import { describe, expect, it } from "vitest";

import { withTiming } from "./operations.js";

describe("timing on a tool result (#1227)", () => {
  it("bounds default request details without changing total call time", () => {
    const requests = Array.from({ length: 12 }, (_, i) => ({
      request: "files",
      requestId: `r${i}`,
      startedAtMs: i,
      totalMs: 1,
    }));
    const result = withTiming(
      { ok: true },
      30,
      requests,
      false,
      "simulation_data",
    ) as any;
    expect(result.timing).toMatchObject({
      operation: "simulation_data",
      totalMs: 30,
      requestCount: 12,
      requestsOmitted: 4,
    });
    expect(result.timing.requests).toHaveLength(8);
    expect(result.timing.requests[0].requestId).toBe("r4");
  });
  const request = {
    request: "circuit",
    startedAtMs: 1840,
    totalMs: 260,
    relayMs: 210,
    editorMs: 90,
    editorVisibility: "visible" as const,
  };

  it("reports the call, each hop, and a one-shot process's startup", () => {
    expect(withTiming({ ok: true }, 301.4, [request], true)).toEqual({
      ok: true,
      timing: {
        totalMs: 301,
        startupMs: 1840,
        requests: [
          {
            request: "circuit",
            totalMs: 260,
            relayMs: 210,
            editorMs: 90,
            editorVisibility: "visible",
          },
        ],
      },
    });
    // No request, or a result that is not an object: nothing to add.
    expect(withTiming({ ok: true }, 3, [], true)).toEqual({ ok: true });
    expect(withTiming("text", 3, [request], false)).toBe("text");
  });

  it("separates visibility observations from unproven latency causes", () => {
    const hidden = withTiming(
      { ok: true },
      400,
      [{ ...request, editorVisibility: "hidden" as const }],
      false,
    ) as { timing: { warning?: { code: string; message: string } } };
    expect(hidden.timing.warning).toMatchObject({ code: "EDITOR_BACKGROUND" });
    expect(hidden.timing.warning?.message).toContain("not a latency diagnosis");
    const slow = withTiming(
      { ok: true },
      9000,
      [{ ...request, relayMs: 8800 }],
      false,
    ) as { timing: { warning?: { code: string; message: string } } };
    expect(slow.timing.warning).toMatchObject({ code: "SLOW_RELAY" });
    expect(slow.timing.warning?.message).toContain("took 9 s");
    const both = withTiming(
      { ok: true },
      9000,
      [{ ...request, relayMs: 8800, editorVisibility: "hidden" }],
      false,
    ) as any;
    expect(both.timing.warning.code).toBe("SLOW_RELAY");
    expect(both.timing.warning.message).not.toContain("bring");
    expect(
      (withTiming({ ok: true }, 300, [request], false) as { timing: object })
        .timing,
    ).not.toHaveProperty("warning");
  });
});
